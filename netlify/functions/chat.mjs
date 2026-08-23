/**
 * Growee — Netlify Function (streaming): /.netlify/functions/chat
 * ══════════════════════════════════════════════════════════
 * Igual que la versión anterior (RAG + Claude + guardado en Supabase), pero
 * ahora reenvía la respuesta de Claude al navegador tal como se va generando,
 * en vez de esperar a tenerla completa. El navegador ve el texto aparecer
 * palabra a palabra de verdad, no una simulación.
 *
 * OPTIMIZACIÓN DE VELOCIDAD (esta versión): la lectura de la memoria de
 * fondo y la resolución del RAG (embedding + búsqueda) NO dependen una de
 * la otra, así que ahora se lanzan en paralelo con Promise.allSettled en
 * vez de esperarse en cadena. Antes: memoria → embedding → búsqueda, tres
 * saltos de red seguidos antes de llamar a Claude. Ahora: memoria en
 * paralelo con (embedding → búsqueda), un salto de red menos en el camino
 * crítico antes del primer token visible para la persona.
 *
 * NUEVO en esta versión: soporte para mensajes con imagen (capturas de
 * pantalla, fotos). El contenido puede llegar como texto plano (string) o
 * como array multimodal [{type:'image',...}, {type:'text', text:'...'}] —
 * getTextFromContent() se encarga de extraer siempre el texto plano para
 * el RAG, la memoria y el historial guardado en Supabase.
 *
 * También guarda memoria de fondo evolutiva. Además del historial en
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
 * OJO: el guardado en Supabase y la actualización de memoria ocurren
 * DESPUÉS de cerrar el stream al navegador (la persona ya no espera por
 * ellos), pero siguen contando contra el mismo límite de ejecución de la
 * función — si una conversación va muy justa de tiempo, es ese trabajo de
 * cierre el que se arriesga a cortarse, no lo que ve la persona.
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

import { checkRateLimit, rateLimitKeyFor } from './_rate-limit.mjs';
// Límite pensado para uso real de chat (varios mensajes seguidos en una
// conversación viva) sin dejar hueco a un bucle o abuso automatizado, que
// aquí es especialmente caro: cada llamada dispara Voyage (embedding) +
// Claude (streaming). Ver _rate-limit.mjs para el porqué y sus límites.
const CHAT_RATE_LIMIT = { max: 20, windowMs: 60_000 };

// Recalibrado en agosto 2026, con 339 metodologías en catálogo (el valor de 6 venía
// de cuando había ~100). Se recuperan 10 fragmentos vía match_knowledge_v2, que
// además aplica suelo de similitud y descarta candidatos casi idénticos entre sí.
const RETRIEVAL_COUNT = 10;
// Suelo ABSOLUTO, solo red de seguridad: si una consulta no se parece a nada del
// catálogo (un "¿qué tiempo hace?"), no se inyecta nada. Medido con consultas reales:
// la similitud consulta→documento vive entre 0,15 y 0,35, así que 0,20 es el punto
// por debajo del cual no hay señal. Ojo: un valor más alto corta en mitad del rango
// útil, porque la curva de similitud baja suave y no tiene acantilado natural.
const RETRIEVAL_MIN_SIMILARITY = 0.2;
// Suelo RELATIVO: se queda todo lo que esté dentro del 80% del mejor match de esa
// consulta concreta. Es lo que de verdad decide el corte, y se adapta a cada consulta
// en vez de imponer un número fijo sobre una escala que varía.
const RETRIEVAL_RELATIVE_FLOOR = 0.8;
// Si dos fragmentos se parecen más que esto entre ellos, solo entra el mejor de los dos.
// Ajustado por encima de la banda de los pares legítimamente distintos (máx. 0,889
// medido en el catálogo actual), así que hoy casi nunca dispara: es un seguro para
// cuando el catálogo crezca, no un parche para el estado actual.
const RETRIEVAL_DIVERSITY_THRESHOLD = 0.92;

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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_knowledge_v2`, {
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
      min_similarity: RETRIEVAL_MIN_SIMILARITY,
      diversity_threshold: RETRIEVAL_DIVERSITY_THRESHOLD,
      relative_floor: RETRIEVAL_RELATIVE_FLOOR,
    }),
  });
  if (!res.ok) {
    console.error('Supabase retrieval error:', await res.text());
    return [];
  }
  return res.json();
}

// Secciones del catálogo que solo sirven para quien mantiene el contenido (contexto
// histórico del autor, notas de edición) y nunca se usan en la conversación en vivo.
// Se recortan SOLO en la copia que se envía a Claude — nunca se toca lo guardado en
// Supabase. Medido sobre el catálogo real: ahorra ~12% del texto de media, sin tocar
// qué fragmentos se buscan ni en qué orden, así que no afecta a la precisión del RAG.
const SECCIONES_A_RECORTAR = [
  /## Autor y origen[\s\S]*?(?=\n## |$)/,
  /## Notas para quien (mantenga|mantiene) este contenido[\s\S]*?(?=\n## |$)/,
];

function recortarParaInyeccion(content) {
  let out = content;
  for (const re of SECCIONES_A_RECORTAR) {
    out = out.replace(re, '');
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function buildKnowledgeBlock(chunks) {
  if (!chunks || chunks.length === 0) return '';
  const formatted = chunks
    .map((c) => `[${c.metodologia}${c.origen ? ` — ${c.origen}` : ''}]\n${recortarParaInyeccion(c.content)}`)
    .join('\n\n---\n\n');
  return `\n\nCONOCIMIENTO RELEVANTE PARA ESTE MENSAJE (úsalo si aplica, cita la metodología y el autor cuando lo uses; no lo menciones si no aporta nada a este mensaje concreto):\n\n${formatted}`;
}

// Cuántos mensajes de usuario recientes se usan para construir la consulta del RAG.
const RETRIEVAL_HISTORY_TURNS = 3;
// Los mensajes que no son el más reciente se recortan a esta longitud: solo aportan
// contexto de tema, no hace falta el texto completo (y así no infla la búsqueda).
const RETRIEVAL_HISTORY_CHARS = 400;

// Antes solo se embebía el último mensaje del usuario. Si ese mensaje es corto o
// ambiguo ("sí", "cuéntame más"), la búsqueda se queda casi sin señal aunque el
// tema real ya se dijo en el mensaje anterior. Ahora se anclan los últimos
// RETRIEVAL_HISTORY_TURNS mensajes de usuario (el más reciente entero, los
// anteriores recortados) para que la búsqueda no pierda el hilo de la conversación.
function buildRetrievalQuery(messages) {
  const userMsgs = messages.filter((m) => m.role === 'user').slice(-RETRIEVAL_HISTORY_TURNS);
  return userMsgs
    .map((m, i) => {
      const text = getTextFromContent(m.content);
      const isLast = i === userMsgs.length - 1;
      return isLast ? text : text.slice(0, RETRIEVAL_HISTORY_CHARS);
    })
    .filter(Boolean)
    .join('\n');
}

// Resuelve embedding + búsqueda de conocimiento en un único paso encadenado,
// para poder lanzarlo junto a la lectura de memoria con Promise.allSettled.
async function resolveRag(modulo, queryText) {
  if (!modulo || !queryText || !VOYAGE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { block: '', topics: [] };
  }
  const embedding = await embedQuery(queryText);
  const chunks = await retrieveKnowledge(embedding, modulo);
  return {
    block: buildKnowledgeBlock(chunks),
    topics: (chunks || []).map((c) => c.metodologia).filter(Boolean),
  };
}

async function saveMessage(userEmail, modulo, role, content, company, ragTopics) {
  const payload = { user_email: userEmail, modulo, role, content };
  if (company) payload.company = company;
  if (ragTopics) payload.rag_topics = ragTopics;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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

// Los mensajes con imagen llegan como array [{type:'image',...}, {type:'text', text:'...'}].
// Esta función siempre devuelve el texto plano, para usarlo en RAG, memoria e historial.
function getTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b.type === 'text');
    const hasImage = content.some((b) => b.type === 'image');
    return (hasImage ? '[Imagen adjunta] ' : '') + (textBlock ? textBlock.text : '');
  }
  return '';
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

  const { messages, system, modulo, userEmail, company, activePlanNote } = body;
  if (!messages || !system) {
    return new Response(JSON.stringify({ error: 'Faltan messages o system en el body' }), { status: 400 });
  }

  const rl = checkRateLimit('chat:' + rateLimitKeyFor(req, userEmail), CHAT_RATE_LIMIT);
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: 'Estás enviando mensajes muy seguido — espera un momento antes de continuar.' }),
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  // El plan de trabajo en fases (si hay uno activo para este módulo) lo calcula y
  // guarda el propio navegador (localStorage), no este backend — aquí solo se
  // añade como una nota de contexto más al system prompt, igual que la memoria de
  // fondo, para que el modelo le dé continuidad en vez de proponer uno nuevo.
  let finalSystem = system + (activePlanNote ? `\n\n${activePlanNote}` : '');
  let ragTopicsList = [];
  let previousMemory = null;

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const canReadMemory = Boolean(modulo && userEmail && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

  // ── Memoria de fondo y RAG en PARALELO ──
  // Antes: memoria → embedding → búsqueda, en cadena (3 saltos de red seguidos).
  // No hay dependencia real entre leer la memoria y resolver el RAG, así que
  // se lanzan a la vez y se espera lo que tarde el más lento de los dos —
  // no la suma de ambos. allSettled para que un fallo en uno no tumbe al otro.
  const [memoryResult, ragResult] = await Promise.allSettled([
    canReadMemory ? getMemorySummary(userEmail, modulo) : Promise.resolve(null),
    resolveRag(modulo, buildRetrievalQuery(messages)),
  ]);

  if (memoryResult.status === 'fulfilled') {
    previousMemory = memoryResult.value;
    finalSystem += buildMemoryBlock(previousMemory);
  } else {
    console.error('Error leyendo memoria de fondo, continuando sin ella:', memoryResult.reason);
  }

  if (ragResult.status === 'fulfilled') {
    finalSystem += ragResult.value.block;
    ragTopicsList = ragResult.value.topics;
  } else {
    console.error('RAG error, continuando sin contexto adicional:', ragResult.reason);
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
              lastUserMsg ? saveMessage(userEmail, modulo, 'user', getTextFromContent(lastUserMsg.content), company) : null,
              fullText ? saveMessage(userEmail, modulo, 'assistant', fullText, company, ragTopicsList.join(', ')) : null,
            ]);
          } catch (saveError) {
            console.error('Error guardando historial (la respuesta al usuario no se ve afectada):', saveError);
          }

          if (lastUserMsg && fullText) {
            await updateMemorySummary(userEmail, modulo, previousMemory, getTextFromContent(lastUserMsg.content), fullText);
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
