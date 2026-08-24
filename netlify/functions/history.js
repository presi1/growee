/**
 * Growee — Netlify Function: /.netlify/functions/history
 * ══════════════════════════════════════════════════════════
 * Devuelve el historial de mensajes guardado de un usuario para un módulo
 * concreto (bienestar o coaching), ordenado cronológicamente.
 *
 * Requiere sesión verificada (header Authorization: Bearer <token>) —
 * el email se toma SIEMPRE del token, nunca del body, para que nadie
 * pueda pedir el historial de otra persona conociendo su email.
 *
 * Variables de entorno necesarias (las mismas que ya usa chat.js):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { verifyAuth } = require('./_verify-auth.js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const auth = await verifyAuth(event);
  if (!auth.ok) {
    return { statusCode: auth.statusCode, body: JSON.stringify({ error: auth.error }) };
  }

  try {
    const { modulo } = JSON.parse(event.body);
    const userEmail = auth.email; // verificado por el token — nunca confiar en el body para esto

    if (!modulo) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta modulo' }) };
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
