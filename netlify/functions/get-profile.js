/**
 * Growee — Netlify Function: /.netlify/functions/get-profile
 * ══════════════════════════════════════════════════════════
 * Devuelve el perfil guardado de un usuario (si existe alguno). Se usa al
 * abrir la app para ver si hay datos editados que deban sobreescribir los
 * que vienen del login/CSV inicial.
 *
 * Requiere sesión verificada (header Authorization: Bearer <token>) — el
 * email se toma SIEMPRE del token, nunca del body. Antes de este cambio,
 * cualquiera podía pedir el perfil (nombre, apellidos, empresa, rol) de
 * otra persona solo conociendo o adivinando su email corporativo — mismo
 * patrón que se cerró antes en history.js, check-admin.js,
 * get-rrhh-stats.js y export-company-data.mjs.
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
  const email = auth.email; // verificado por el token — nunca confiar en el body para esto

  try {
    const url = `${SUPABASE_URL}/rest/v1/user_profiles?email=eq.${encodeURIComponent(email)}&select=*`; // select=* ya incluye la nueva columna team
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
