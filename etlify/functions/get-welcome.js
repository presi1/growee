/**
 * Growee — Netlify Function: /.netlify/functions/get-welcome
 * ══════════════════════════════════════════════════════════
 * Si existe memoria de fondo de conversaciones anteriores, genera un mensaje
 * de bienvenida breve que retoma el hilo de forma natural (p.ej. pregunta
 * cómo fue el paso concreto que se propuso la última vez). Si no hay memoria
 * previa (primera vez), devuelve welcome: null para que el frontend use el
 * saludo genérico de siempre.
 *
 * Usa un modelo barato (Haiku) porque es un mensaje corto y no crítico.
 *
 * Variables de entorno necesarias (las mismas de siempre):
 *   ANTHROPIC_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userEmail, modulo, userName } = JSON.parse(event.body);
    if (!userEmail || !modulo) {
      return { statusCode: 400, body: JSON.stringify({ welcome: null }) };
    }

    const url = `${SUPABASE_URL}/rest/v1/user_memory_summary`
      + `?email=eq.${encodeURIComponent(userEmail)}`
      + `&modulo=eq.${encodeURIComponent(modulo)}`
      + `&select=summary,last_commitment`;

    const memRes = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!memRes.ok) {
      return { statusCode: 200, body: JSON.stringify({ welcome: null }) };
    }

    const rows = await memRes.json();
    const memory = rows[0];

    if (!memory || !memory.summary) {
      return { statusCode: 200, body: JSON.stringify({ welcome: null }) };
    }

    const prompt = `Genera un único mensaje de bienvenida breve (máximo 2 frases) para retomar una conversación de ${modulo === 'coaching' ? 'coaching profesional' : 'apoyo emocional'} con ${userName || 'esta persona'}, en tono cercano y natural, nunca clínico ni robótico.

Resumen de la situación de fondo:
${memory.summary}

${memory.last_commitment ? `Paso concreto que quedó pendiente de la última vez: ${memory.last_commitment}` : ''}

${memory.last_commitment
  ? 'Pregunta de forma natural cómo le fue con ese paso concreto, sin sonar a checklist.'
  : 'Retoma el hilo de la situación de fondo de forma natural, sin sonar a que repites un resumen.'}

Responde SOLO con el mensaje de bienvenida, sin comillas, sin preámbulo, sin explicar lo que vas a hacer.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('Error generando bienvenida:', await res.text());
      return { statusCode: 200, body: JSON.stringify({ welcome: null }) };
    }

    const data = await res.json();
    const welcome = data.content?.[0]?.text?.trim() || null;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ welcome }),
    };
  } catch (err) {
    console.error('get-welcome.js error:', err);
    return { statusCode: 200, body: JSON.stringify({ welcome: null }) };
  }
};
