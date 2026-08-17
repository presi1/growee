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

// Bajado de 10 a 7 en agosto 2026, con 500 metodologías en catálogo, para acortar
// el tiempo de respuesta: cada fragmento son ~3.200 caracteres de media, así que
// cada mensaje cargaba a Claude con ~32.000 caracteres (~8.000 tokens) solo de
// catálogo antes de escribir la primera letra. Medido contra la batería de 60
// pruebas de recuperación (retrieval_tests): 7 da exactamente el mismo % de
// aciertos que 10 (51/60) — los dos casos que se pierden al bajar a 6 están
// justo en la posición 7. Por debajo de 7 sí se pierde recall real; no bajar más
// sin volver a medir.
const RETRIEVAL_COUNT = 7;
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
// En el PRIMER mensaje de una sesión no hay hilo al que anclarse y el mensaje suele
// ser corto y vago ("estoy agotado"), así que todo el catálogo parece igual de tibio.
// Ahí no interesa traer MÁS material —medido: la posición 20 está a 0,27 y la 40 a
// 0,25, igual de flojas— sino repartir los mismos 10 entre áreas distintas, para que
// el asistente vea por dónde puede ir la conversación en vez de diez variaciones de
// la misma suposición. 0,60 es el valor medido: mantiene los 10 fragmentos y sube la
// cobertura de áreas; por debajo empieza a perder fragmentos sin ganar variedad.
const RETRIEVAL_DIVERSITY_THRESHOLD_APERTURA = 0.6;
// Cuántos mensajes del usuario se juntan para construir la consulta de búsqueda.
// Antes se embebía solo el último, así que un "sí, exacto" en el turno 5 tiraba a la
// basura todo lo que la persona había contado antes. Con 3 el "sí, exacto" viaja
// acompañado del contexto que le da sentido.
const RETRIEVAL_HISTORY_TURNS = 3;
// Los mensajes anteriores al último se recortan: aportan contexto, pero el mensaje
// actual debe seguir dominando la consulta.
const RETRIEVAL_HISTORY_CHARS = 400;

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

async function retrieveKnowledge(embedding, modulo, esApertura = false) {
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
      diversity_threshold: esApertura
        ? RETRIEVAL_DIVERSITY_THRESHOLD_APERTURA
        : RETRIEVAL_DIVERSITY_THRESHOLD,
      relative_floor: RETRIEVAL_RELATIVE_FLOOR,
    }),
  });
  if (!res.ok) {
    console.error('Supabase retrieval error:', await res.text());
    return [];
  }
  return res.json();
}

// Quita, SOLO para lo que se envía a Claude en este mensaje (nunca toca lo
// guardado en knowledge_chunks), dos secciones que no aportan a la conversación:
//   - "Autor y origen": ya viaja como cabecera "[metodologia — origen]", así que
//     el desarrollo largo del autor es redundante aquí.
//   - Las notas de mantenimiento del catálogo, bajo tres títulos distintos según
//     cuándo se escribió la entrada ("Notas para quien mantenga/mantiene este
//     contenido", "Notas de mantenimiento") — están escritas para quien mantiene
//     el catálogo, no para responder a la persona.
// Entre las dos quitan ~18% del texto de una entrada media, medido sobre las
// 500 reales (1.605.115 → 1.317.682 caracteres). Las cabeceras del catálogo
// son ## en unas entradas y ### en otras (428 con ## y 72 con ###), así que
// el patrón acepta ambas.
// Si el formato de una entrada cambiara y el título de una sección dejara de
// coincidir, esa sección simplemente no se recorta — no rompe nada.
const SECCIONES_A_RECORTAR = [
  /^#{2,3}\s*Autor y origen\s*$/im,
  /^#{2,3}\s*Notas para quien mantenga este contenido\s*$/im,
  /^#{2,3}\s*Notas para quien mantiene este contenido\s*$/im,
  /^#{2,3}\s*Notas de mantenimiento\s*$/im,
];
function recortarParaInyeccion(content) {
  if (typeof content !== 'string') return content;
  let out = content;
  for (const encabezado of SECCIONES_A_RECORTAR) {
    // Ojo con el flag 'm': con él, "$" significa "antes de CUALQUIER salto de
    // línea", no "fin de la cadena". Como justo después de una cabecera suele
    // venir una línea en blanco, un "$" normal se cumplía ahí mismo y el
    // recorte no comía nada del cuerpo — solo la línea del título. "(?![\s\S])"
    // exige que no quede NINGÚN carácter después, así que sí es fin real de
    // cadena, funcione con 'm' o sin él.
    out = out.replace(
      new RegExp(encabezado.source + '[\\s\\S]*?(?=\\n#{2,3}\\s|(?![\\s\\S]))', 'im'),
      ''
    );
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

// Construye el texto que se embebe para buscar en el catálogo.
//
// El último mensaje va SIEMPRE al final y completo, porque es el que debe pesar más.
// Los anteriores se añaden delante, recortados, solo para dar contexto: así un
// "sí, exacto" o un "no sé" hereda de qué se estaba hablando en lugar de buscar a
// ciegas. Devuelve además si estamos en el primer mensaje de la sesión, que se trata
// distinto (ver RETRIEVAL_DIVERSITY_THRESHOLD_APERTURA).
function buildRetrievalQuery(messages) {
  const userMsgs = (messages || []).filter((m) => m && m.role === 'user');
  if (userMsgs.length === 0) return null;

  const recientes = userMsgs.slice(-RETRIEVAL_HISTORY_TURNS);
  const ultimoIdx = recientes.length - 1;

  const partes = recientes
    .map((m, i) => {
      const texto = (getTextFromContent(m.content) || '').trim();
      if (!texto) return '';
      // el actual entero; los de contexto, recortados
      return i === ultimoIdx ? texto : texto.slice(0, RETRIEVAL_HISTORY_CHARS);
    })
    .filter(Boolean);

  if (partes.length === 0) return null;

  return { text: partes.join('\n'), esApertura: userMsgs.length === 1 };
}

// Resuelve embedding + búsqueda de conocimiento en un único paso encadenado,
// para poder lanzarlo junto a la lectura de memoria con Promise.allSettled.
async function resolveRag(modulo, retrieval) {
  if (!modulo || !retrieval || !VOYAGE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { block: '', topics: [] };
  }
  const embedding = await embedQuery(retrieval.text);
  const chunks = await retrieveKnowledge(embedding, modulo, retrieval.esApertura);
  return {
    block: buildKnowledgeBlock(chunks),
    topics: (chunks || []).map((c) => c.metodologia).filter(Boolean),
  };
}

// Extrae el marcador [METODOLOGIA: nombre] que el modelo añade al final cuando
// de verdad APLICA una metodología del catálogo.
//
// Por qué existe: rag_topics guarda lo que se le ENSEÑÓ al modelo (10 fragmentos),
// que no es lo mismo que lo que acabó USANDO. Sin esto no hay forma de saber qué
// proporción de respuestas se apoya en el catálogo — ni de que el "Temas más
// trabajados" del panel de RRHH refleje lo aplicado en vez de lo recuperado.
//
// El texto se sigue guardando crudo, con los marcadores dentro: el frontend los
// limpia al pintar, y la lógica de fijar mensajes en directo compara contra el
// texto crudo, así que cambiarlo aquí la rompería.
// No se ancla a fin de texto a propósito. El prompt le pide a este marcador que
// vaya "después de cualquier otro marcador", pero compite con otros cuatro que
// también dicen ir "al final" ([OPCIONES:], [GUIA:], [PRACTICA_FIN:], [CRISIS]),
// así que el orden real no está garantizado. Anclando a $ se perdía el registro
// en silencio cada vez que el modelo dejaba otro marcador detrás.
// Si hubiera más de uno, nos quedamos con el último.
function extraerMetodologiaAplicada(texto) {
  if (typeof texto !== 'string') return null;
  const encontrados = texto.match(/\[METODOLOGIA:\s*[^\]]+\]/g);
  if (!encontrados || encontrados.length === 0) return null;
  const ultimo = encontrados[encontrados.length - 1];
  const nombre = ultimo.replace(/^\[METODOLOGIA:\s*/, '').replace(/\]$/, '').trim();
  return nombre ? nombre.slice(0, 200) : null;
}

async function saveMessage(userEmail, modulo, role, content, company, ragTopics, metodologiaAplicada) {
  const payload = { user_email: userEmail, modulo, role, content };
  if (company) payload.company = company;
  if (ragTopics) payload.rag_topics = ragTopics;
  if (metodologiaAplicada) payload.metodologia_aplicada = metodologiaAplicada;

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

  const { messages, system, modulo, userEmail, company } = body;
  if (!messages || !system) {
    return new Response(JSON.stringify({ error: 'Faltan messages o system en el body' }), { status: 400 });
  }

  let finalSystem = system;
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
              fullText ? saveMessage(userEmail, modulo, 'assistant', fullText, company, ragTopicsList.join(', '), extraerMetodologiaAplicada(fullText)) : null,
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
