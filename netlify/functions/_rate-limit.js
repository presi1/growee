/**
 * Growee — utilidad compartida de rate limiting (versión CommonJS)
 * ══════════════════════════════════════════════════════════
 * Misma lógica que _rate-limit.mjs, duplicada en formato CommonJS porque
 * las funciones más antiguas de este proyecto usan exports.handler (formato
 * clásico de Netlify Functions) en vez de export default (el formato nuevo,
 * basado en Request/Response, que sí soporta import de módulos ES sin más).
 * Mismas limitaciones documentadas allí: el contador vive en memoria del
 * proceso de la función, no es un almacén compartido garantizado entre
 * todas las instancias — es la primera barrera contra abuso, no la última.
 *
 * Uso:
 *   const { checkRateLimit, rateLimitKeyFor } = require('./_rate-limit.js');
 *   const rl = checkRateLimit('metodo-ficha:' + key, { max: 15, windowMs: 60_000 });
 *   if (!rl.allowed) return { statusCode: 429, body: JSON.stringify({ error: '...' }) };
 */

const buckets = new Map();
const MAX_BUCKETS = 5000;

function checkRateLimit(key, opts) {
  const max = (opts && opts.max) || 20;
  const windowMs = (opts && opts.windowMs) || 60000;
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: now };
    buckets.set(key, bucket);
  }

  bucket.count += 1;

  if (buckets.size > MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey !== undefined) buckets.delete(oldestKey);
  }

  const allowed = bucket.count <= max;
  const retryAfterMs = allowed ? 0 : windowMs - (now - bucket.windowStart);

  return { allowed: allowed, remaining: Math.max(0, max - bucket.count), retryAfterMs: retryAfterMs };
}

// event.headers en el formato clásico de Netlify Functions viene en minúsculas.
function rateLimitKeyFor(event, userEmail) {
  if (userEmail) return String(userEmail).toLowerCase();
  const headers = event.headers || {};
  const fwd = headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'] || 'sin-identificar';
  return fwd.split(',')[0].trim();
}

module.exports = { checkRateLimit: checkRateLimit, rateLimitKeyFor: rateLimitKeyFor };
