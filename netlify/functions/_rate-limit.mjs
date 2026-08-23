/**
 * Growee — utilidad compartida de rate limiting
 * ══════════════════════════════════════════════════════════
 * Límite simple de peticiones por clave (normalmente el email del usuario,
 * o su IP si no hay email) dentro de una ventana de tiempo, para evitar que
 * una sola persona (o un bot) pueda machacar las funciones que llaman a la
 * API de Anthropic/Voyage sin ningún control, con el coste económico y de
 * disponibilidad que eso supondría.
 *
 * LIMITACIÓN IMPORTANTE, para que quede documentada y nadie confíe en esto
 * más de lo que da de sí: el contador vive en memoria del propio proceso de
 * la función (un Map normal). Netlify recicla y reutiliza instancias de
 * función mientras hay tráfico ("instancias calientes"), así que esto
 * funciona razonablemente bien en la práctica — pero no es una garantía
 * dura: si Netlify arranca una instancia nueva (tras inactividad, o al
 * escalar por carga), ese contador empieza de cero. No sustituye a un
 * almacén compartido real (Redis/Upstash) si el tráfico crece lo bastante
 * para que esto importe de verdad — es la primera barrera, no la última.
 *
 * Uso:
 *   import { checkRateLimit } from './_rate-limit.mjs';
 *   const rl = checkRateLimit('chat:' + userEmail, { max: 20, windowMs: 60_000 });
 *   if (!rl.allowed) return new Response(JSON.stringify({ error: 'Demasiadas peticiones, espera un momento.' }), { status: 429 });
 */

const buckets = new Map(); // clave -> { count, windowStart }

// Limpieza periódica para no acumular memoria indefinidamente con claves viejas.
const MAX_BUCKETS = 5000;

export function checkRateLimit(key, { max = 20, windowMs = 60_000 } = {}) {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  // Poda simple si el mapa crece demasiado — quita las entradas más antiguas.
  if (buckets.size > MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey !== undefined) buckets.delete(oldestKey);
  }

  const allowed = bucket.count <= max;
  const retryAfterMs = allowed ? 0 : windowMs - (now - bucket.windowStart);

  return { allowed, remaining: Math.max(0, max - bucket.count), retryAfterMs };
}

// Identificador razonable para limitar: el email si lo hay (identifica a la
// persona real, no solo la conexión), si no la IP que reenvía Netlify.
export function rateLimitKeyFor(req, userEmail) {
  if (userEmail) return String(userEmail).toLowerCase();
  const fwd = req.headers?.get?.('x-nf-client-connection-ip')
    || req.headers?.get?.('x-forwarded-for')
    || 'sin-identificar';
  return fwd.split(',')[0].trim();
}
