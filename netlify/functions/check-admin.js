/**
 * Growee — Netlify Function: /.netlify/functions/check-admin
 * ══════════════════════════════════════════════════════════
 * Comprueba si el email dado está en la tabla company_admins, y de qué
 * empresa. Se usa al cargar la app para decidir si se muestra el enlace
 * al Panel de RRHH — no da acceso a nada por sí sola, solo informa.
 *
 * Devuelve también adminLevel ('company' | 'team') y, si es 'team', el
 * equipo concreto — para RBAC granular (backlog punto 7): un admin_level
 * 'team' solo debe ver las estadísticas de su equipo, no de toda la
 * empresa. El filtrado real ocurre en get-rrhh-stats.js/export-company-data
 * (esta función solo informa qué nivel tiene, no filtra nada).
 *
 * Requiere sesión verificada (header Authorization: Bearer <token>) —
 * el email se toma del token, no del body, para no permitir comprobar
 * el estado de admin de emails ajenos.
 *
 * Variables de entorno necesarias (las mismas de siempre):
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
    return { statusCode: 200, body: JSON.stringify({ isAdmin: false }) }; // fallo silencioso: no bloquear la carga de la app por esto
  }

  try {
    const email = auth.email; // verificado por el token — nunca confiar en el body para esto

    const url = `${SUPABASE_URL}/rest/v1/company_admins?email=eq.${encodeURIComponent(email)}&select=company,admin_level,team`;
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
      body: JSON.stringify({
        isAdmin: true,
        company: rows[0].company,
        adminLevel: rows[0].admin_level || 'company',
        team: rows[0].team || null,
      }),
    };
  } catch (err) {
    console.error('check-admin.js error:', err);
    return { statusCode: 200, body: JSON.stringify({ isAdmin: false }) };
  }
};
