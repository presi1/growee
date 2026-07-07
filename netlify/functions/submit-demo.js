/**
 * Growee — Netlify Function: /.netlify/functions/submit-demo
 * ══════════════════════════════════════════════════════════
 * Recibe los datos del formulario "Solicitar demo" y los guarda en Supabase
 * (tabla demo_requests). Aquí es donde "van" los formularios: puedes verlos,
 * filtrarlos y exportarlos a CSV desde el Table Editor de Supabase.
 *
 * Variables de entorno necesarias (las mismas que ya usan chat.js/history.js):
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
    const { nombre, apellidos, email, empresa, tamano_equipo, rol, modulo_interes, reto } = body;

    if (!nombre || !apellidos || !email || !empresa || !tamano_equipo || !rol || !modulo_interes) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan campos obligatorios' }) };
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/demo_requests`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nombre, apellidos, email, empresa,
        tamano_equipo, rol, modulo_interes,
        reto: reto || null,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Error guardando solicitud de demo:', errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'No se pudo guardar la solicitud' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('submit-demo.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
