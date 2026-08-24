/**
 * Growee — utilidad compartida de verificación de sesión (formato ES Modules)
 * ══════════════════════════════════════════════════════════
 * Misma lógica que _verify-auth.js, duplicada en formato ESM para las
 * funciones que usan export default (formato Request/Response) en vez
 * de exports.handler. Ver _verify-auth.js para el porqué de esta brecha
 * y cómo se cierra.
 *
 * Uso:
 *   import { verifyAuth } from './_verify-auth.mjs';
 *   const auth = await verifyAuth(req);
 *   if (!auth.ok) return new Response(JSON.stringify({ error: auth.error }), { status: auth.statusCode });
 *   const email = auth.email; // ya en minúsculas, verificado
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function verifyAuth(req) {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
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
    console.error('_verify-auth.mjs error:', err);
    return { ok: false, statusCode: 500, error: 'Error verificando la sesión.' };
  }
}
