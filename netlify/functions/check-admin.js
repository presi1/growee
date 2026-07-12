/**
 * Growee — Netlify Function: /.netlify/functions/check-admin
 * ══════════════════════════════════════════════════════════
 * Comprueba si el email dado está en la tabla company_admins, y de qué
 * empresa. Se usa al cargar la app para decidir si se muestra el enlace
 * al Panel de RRHH — no da acceso a nada por sí sola, solo informa.
 *
 * Variables de entorno necesarias (las mismas de siempre):
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
    const { email } = JSON.parse(event.body);
    if (!email) {
      return { statusCode: 200, body: JSON.stringify({ isAdmin: false }) };
    }

    const url = `${SUPABASE_URL}/rest/v1/company_admins?email=eq.${encodeURIComponent(email.toLowerCase())}&select=company`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!res.ok) {
      return { statusCode: 200, body: JSON.stringify({ isAdmin: false }) };
    }

    const rows = await res.json();
    if (rows.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ isAdmin: false }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAdmin: true, company: rows[0].company }),
    };
  } catch (err) {
    console.error('check-admin.js error:', err);
    return { statusCode: 200, body: JSON.stringify({ isAdmin: false }) };
  }
};
