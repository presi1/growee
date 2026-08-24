/**
 * Growee — utilidad compartida de verificación de sesión (formato CommonJS)
 * ══════════════════════════════════════════════════════════
 * Hasta ahora, varias funciones (history.js, get-rrhh-stats.js,
 * export-company-data.mjs, check-admin.js) confiaban en el campo
 * `email`/`userEmail` que el propio cliente manda en el body — sin
 * comprobar en ningún momento que quien hace la petición es realmente
 * esa persona autenticada. Eso permite a cualquiera, sin pasar por la
 * web, pedir el historial de conversaciones de otra persona o las
 * estadísticas de RRHH de una empresa con solo conocer/adivinar un
 * email corporativo.
 *
 * Esta función cierra esa brecha: exige un header
 *   Authorization: Bearer <access_token>
 * con el JWT que ya genera supabaseClient.auth.getSession() en el
 * frontend, lo valida contra Supabase Auth (GoTrue) usando la
 * service role key, y devuelve el email verificado — que es el único
 * que las funciones deben usar a partir de ahora, ignorando cualquier
 * email que venga en el body.
 *
 * Uso:
 *   const { verifyAuth } = require('./_verify-auth.js');
 *   const auth = await verifyAuth(event);
 *   if (!auth.ok) return { statusCode: auth.statusCode, body: JSON.stringify({ error: auth.error }) };
 *   const email = auth.email; // ya en minúsculas, verificado — no confiar en el body para esto
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function verifyAuth(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) {
    return { ok: false, statusCode: 401, error: 'Falta la sesión. Vuelve a iniciar sesión e inténtalo de nuevo.' };
  }
  const token = match[1];

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return { ok: false, statusCode: 401, error: 'Tu sesión ha caducado. Vuelve a iniciar sesión.' };
    }

    const user = await res.json();
    if (!user || !user.email) {
      return { ok: false, statusCode: 401, error: 'No se pudo verificar la sesión.' };
    }

    return { ok: true, email: user.email.toLowerCase(), userId: user.id };
  } catch (err) {
    console.error('_verify-auth.js error:', err);
    return { ok: false, statusCode: 500, error: 'Error verificando la sesión.' };
  }
}

module.exports = { verifyAuth };
