/**
 * Growee — Netlify Function: /.netlify/functions/submit-support
 * ══════════════════════════════════════════════════════════
 * Recibe el formulario de "Ayuda y soporte" (menú de usuario) y lo guarda
 * en Supabase (tabla support_requests). Igual que submit-demo.js, aquí es
 * donde "van" estos mensajes — se ven, filtran y exportan desde el Table
 * Editor de Supabase.
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
    const body = JSON.parse(event.body);
    const { nombre, email, modulo, mensaje } = body;

    if (!email || !mensaje) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos obligatorios' }) };
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/support_requests`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nombre: nombre || null,
        email,
        modulo: modulo || null,
        mensaje,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Error guardando solicitud de soporte:', errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'No se pudo enviar' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('submit-support.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
