/**
 * Growee — Netlify Function: /.netlify/functions/history
 * ══════════════════════════════════════════════════════════
 * Devuelve el historial de mensajes guardado de un usuario para un módulo
 * concreto (bienestar o coaching), ordenado cronológicamente.
 *
 * Variables de entorno necesarias (las mismas que ya usa chat.js):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userEmail, modulo } = JSON.parse(event.body);

    if (!userEmail || !modulo) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan userEmail o modulo' }) };
    }

    const url = `${SUPABASE_URL}/rest/v1/chat_messages`
      + `?user_email=eq.${encodeURIComponent(userEmail)}`
      + `&modulo=eq.${encodeURIComponent(modulo)}`
      + `&select=role,content,created_at`
      + `&order=created_at.asc`;

    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!res.ok) {
      console.error('Supabase history fetch error:', await res.text());
      return { statusCode: 200, body: JSON.stringify([]) }; // fallar en silencio: mejor sin historial que romper el chat
    }

    const rows = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows),
    };
  } catch (err) {
    console.error('history.js error:', err);
    return { statusCode: 200, body: JSON.stringify([]) };
  }
};
