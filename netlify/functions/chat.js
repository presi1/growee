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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { messages, system, modulo } = JSON.parse(event.body);

    if (!messages || !system) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan messages o system en el body' }) };
    }

    let finalSystem = system;

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

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: finalSystem,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic API error:', errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'Error al contactar con Claude' }) };
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error('chat.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
