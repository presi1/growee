/**
 * Growee — Netlify Function: /.netlify/functions/get-profile
 * ══════════════════════════════════════════════════════════
 * Devuelve el perfil guardado de un usuario (si existe alguno). Se usa al
 * abrir la app para ver si hay datos editados que deban sobreescribir los
 * que vienen del login/CSV inicial.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { email } = JSON.parse(event.body);
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta email' }) };
    }

    const url = `${SUPABASE_URL}/rest/v1/user_profiles?email=eq.${encodeURIComponent(email)}&select=*`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!res.ok) {
      console.error('Error recuperando perfil:', await res.text());
      return { statusCode: 200, body: JSON.stringify(null) };
    }

    const rows = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows[0] || null),
    };
  } catch (err) {
    console.error('get-profile.js error:', err);
    return { statusCode: 200, body: JSON.stringify(null) };
  }
};
