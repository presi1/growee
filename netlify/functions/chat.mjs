/**
 * Growee — Netlify Function (streaming): /.netlify/functions/chat
 * ══════════════════════════════════════════════════════════
 * Igual que la versión anterior (RAG + Claude + guardado en Supabase), pero
 * ahora reenvía la respuesta de Claude al navegador tal como se va generando,
 * en vez de esperar a tenerla completa. El navegador ve el texto aparecer
 * palabra a palabra de verdad, no una simulación.
 *
 * IMPORTANTE: este archivo usa el formato NUEVO de Netlify Functions
 * (export default, Request/Response), no el antiguo (exports.handler).
 * Por eso tiene extensión .mjs — así Netlify sabe que es un módulo ES
 * sin depender de que haya un package.json con "type":"module".
 *
 * Límite real de Netlify a tener en cuenta: las funciones con streaming
 * tienen un tope de 10 segundos de ejecución total. Si Claude tarda más
 * que eso en terminar de generar la respuesta, el stream se corta. Por
 * eso aquí limitamos max_tokens a un valor conservador (700).
 *
 * Variables de entorno necesarias (las mismas de siempre):
 *   ANTHROPIC_API_KEY
 *   VOYAGE_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RETRIEVAL_COUNT = 4;

async function embedQuery(text) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: [text],
      model: 'voyage-3-lite',
      input_type: 'query',
    }),
  });
  if (!res.ok) throw new Error(`Voyage AI error: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function retrieveKnowledge(embedding, modulo) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_knowledge`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query_embedding: embedding,
      match_modulo: modulo,
      match_count: RETRIEVAL_COUNT,
    }),
  });
  if (!res.ok) {
    console.error('Supabase retrieval error:', await res.text());
    return [];
  }
  return res.json();
}

function buildKnowledgeBlock(chunks) {
  if (!chunks || chunks.length === 0) return '';
  const formatted = chunks
    .map((c) => `[${c.metodologia}${c.origen ? ` — ${c.origen}` : ''}]\n${c.content}`)
    .join('\n\n---\n\n');
  return `\n\nCONOCIMIENTO RELEVANTE PARA ESTE MENSAJE (úsalo si aplica, cita la metodología y el autor cuando lo uses; no lo menciones si no aporta nada a este mensaje concreto):\n\n${formatted}`;
}

async function saveMessage(userEmail, modulo, role, content) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_email: userEmail, modulo, role, content }),
  });
  if (!res.ok) {
    console.error('Error guardando mensaje en el historial:', await res.text());
  }
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'JSON inválido en el body' }), { status: 400 });
  }

  const { messages, system, modulo, userEmail } = body;
  if (!messages || !system) {
    return new Response(JSON.stringify({ error: 'Faltan messages o system en el body' }), { status: 400 });
  }

  let finalSystem = system;

  // RAG: igual que antes, se resuelve ANTES de llamar a Claude (rápido: embedding + búsqueda vectorial)
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (modulo && lastUserMsg && VOYAGE_API_KEY && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const embedding = await embedQuery(lastUserMsg.content);
      const chunks = await retrieveKnowledge(embedding, modulo);
      finalSystem += buildKnowledgeBlock(chunks);
    } catch (ragError) {
      console.error('RAG error, continuando sin contexto adicional:', ragError);
    }
  }

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 700, // conservador a propósito: el streaming se corta a los 10s totales
        system: finalSystem,
        stream: true,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
  } catch (fetchErr) {
    console.error('Error llamando a Anthropic:', fetchErr);
    return new Response(JSON.stringify({ error: 'Error al contactar con Claude' }), { status: 502 });
  }

  if (!anthropicRes.ok || !anthropicRes.body) {
    const errText = await anthropicRes.text().catch(() => '');
    console.error('Anthropic API error:', errText);
    return new Response(JSON.stringify({ error: 'Error al contactar con Claude' }), { status: 502 });
  }

  const decoder = new TextDecoder();
  let sseBuffer = '';
  let fullText = '';

  const stream = new ReadableStream({
    async start(controller) {
      const reader = anthropicRes.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          controller.enqueue(value); // reenvía el trozo tal cual al navegador, sin esperar

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const json = JSON.parse(line.slice(6));
              if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
                fullText += json.delta.text;
              }
            } catch (e) { /* líneas que no son JSON (ping, etc.) */ }
          }
        }
      } catch (streamErr) {
        console.error('Error leyendo el stream de Anthropic:', streamErr);
      } finally {
        controller.close();
        // Guardar el intercambio en el historial persistente, ya con el texto completo acumulado.
        if (userEmail && modulo && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
          try {
            await Promise.all([
              lastUserMsg ? saveMessage(userEmail, modulo, 'user', lastUserMsg.content) : null,
              fullText ? saveMessage(userEmail, modulo, 'assistant', fullText) : null,
            ]);
          } catch (saveError) {
            console.error('Error guardando historial (la respuesta al usuario no se ve afectada):', saveError);
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
};
