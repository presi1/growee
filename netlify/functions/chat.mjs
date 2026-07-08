/**
 * Growee — Netlify Function (streaming): /.netlify/functions/chat
 * ══════════════════════════════════════════════════════════
 * Igual que la versión anterior (RAG + Claude + guardado en Supabase), pero
 * ahora reenvía la respuesta de Claude al navegador tal como se va generando,
 * en vez de esperar a tenerla completa. El navegador ve el texto aparecer
 * palabra a palabra de verdad, no una simulación.
 *
 * NUEVO en esta versión: memoria de fondo evolutiva. Además del historial en
 * crudo, se mantiene un resumen compacto por usuario+módulo (tabla
 * user_memory_summary) que se actualiza con un modelo barato (Haiku) tras
 * cada intercambio, y se inyecta en el system prompt para dar continuidad
 * sin tener que releer toda la conversación.
 *
 * IMPORTANTE: este archivo usa el formato NUEVO de Netlify Functions
 * (export default, Request/Response), no el antiguo (exports.handler).
 * Por eso tiene extensión .mjs — así Netlify sabe que es un módulo ES
 * sin depender de que haya un package.json con "type":"module".
 *
 * Límite real de Netlify a tener en cuenta: las funciones con streaming
 * tienen un tope de 10 segundos de ejecución total. Si Claude tarda más
 * que eso en terminar de generar la respuesta, el stream se corta. Por
 * eso aquí limitamos max_tokens a un valor conservador (700). La
 * actualización de memoria añade un poco de tiempo tras el streaming —
 * si ves respuestas cortadas con más frecuencia, avisa para ajustarlo.
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

const RETRIEVAL_COUNT = 6; // subido de 4 a 6: con 71 fragmentos en catálogo, 4 se quedaba corto

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

async function getMemorySummary(userEmail, modulo) {
  const url = `${SUPABASE_URL}/rest/v1/user_memory_summary`
    + `?email=eq.${encodeURIComponent(userEmail)}`
    + `&modulo=eq.${encodeURIComponent(modulo)}`
    + `&select=summary,last_commitment`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

function buildMemoryBlock(memory) {
  if (!memory || !memory.summary) return '';
  let block = `\n\nMEMORIA DE FONDO DE ESTA PERSONA (resumen acumulado de conversaciones anteriores, úsalo para dar continuidad sin repetir preguntas ya respondidas):\n\n${memory.summary}`;
  if (memory.last_commitment) {
    block += `\n\nCompromiso o paso concreto que quedó pendiente de la última vez: ${memory.last_commitment}`;
  }
  return block;
}

async function updateMemorySummary(userEmail, modulo, previousMemory, userMsg, aiReply) {
  const prompt = `Mantienes un resumen breve y actualizado de una conversación de ${modulo === 'coaching' ? 'coaching profesional' : 'apoyo emocional'} entre una persona y un asistente de IA, para dar continuidad entre sesiones.

Resumen anterior:
${previousMemory?.summary || '(sin resumen previo, es la primera conversación)'}

Compromiso pendiente anterior:
${previousMemory?.last_commitment || '(ninguno)'}

Nuevo intercambio:
Persona: ${userMsg}
Asistente: ${aiReply}

Devuelve SOLO un JSON con este formato exacto, sin texto antes ni después, sin bloques de código:
{"summary": "resumen actualizado en máximo 100 palabras: situación de fondo relevante, objetivos en curso, técnicas ya probadas, personas importantes mencionadas", "last_commitment": "el paso concreto más reciente que el asistente propuso para la próxima vez, o null si no hubo ninguno"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error('Error generando resumen de memoria:', await res.text());
      return;
    }
    const data = await res.json();
    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    await fetch(`${SUPABASE_URL}/rest/v1/user_memory_summary?on_conflict=email,modulo`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        email: userEmail,
        modulo,
        summary: parsed.summary || previousMemory?.summary || null,
        last_commitment: parsed.last_commitment || null,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (memError) {
    console.error('Error actualizando memoria de fondo (no afecta a la respuesta ya dada):', memError);
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

  // Memoria de fondo: resumen acumulado de conversaciones anteriores (distinto del historial en crudo)
  let previousMemory = null;
  if (modulo && userEmail && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      previousMemory = await getMemorySummary(userEmail, modulo);
      finalSystem += buildMemoryBlock(previousMemory);
    } catch (memReadError) {
      console.error('Error leyendo memoria de fondo, continuando sin ella:', memReadError);
    }
  }

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
        max_tokens: 700,
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

          controller.enqueue(value);

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
        if (userEmail && modulo && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
          try {
            await Promise.all([
              lastUserMsg ? saveMessage(userEmail, modulo, 'user', lastUserMsg.content) : null,
              fullText ? saveMessage(userEmail, modulo, 'assistant', fullText) : null,
            ]);
          } catch (saveError) {
            console.error('Error guardando historial (la respuesta al usuario no se ve afectada):', saveError);
          }

          if (lastUserMsg && fullText) {
            await updateMemorySummary(userEmail, modulo, previousMemory, lastUserMsg.content, fullText);
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
