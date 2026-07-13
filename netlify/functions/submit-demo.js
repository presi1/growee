/**
 * Growee — Netlify Function: /.netlify/functions/submit-demo
 * ══════════════════════════════════════════════════════════
 * Recibe los datos del formulario "Solicitar demo", los guarda en Supabase
 * (tabla demo_requests), y manda un email de aviso a través de Resend para
 * que no dependas de entrar a mirar Supabase a mano.
 *
 * Variables de entorno necesarias:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY       — clave de tu cuenta de Resend (resend.com)
 *   NOTIFICATION_EMAIL   — el email donde quieres recibir el aviso
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;

async function sendNotificationEmail(subject, htmlBody) {
  if (!RESEND_API_KEY || !NOTIFICATION_EMAIL) {
    console.log('Resend no configurado todavía (faltan RESEND_API_KEY o NOTIFICATION_EMAIL) — se omite el email de aviso.');
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Growee <onboarding@resend.dev>', // cambia esto una vez verifiques tu propio dominio en Resend
        to: [NOTIFICATION_EMAIL],
        subject,
        html: htmlBody,
      }),
    });
    if (!res.ok) {
      console.error('Error enviando email de aviso (no afecta al guardado):', await res.text());
    }
  } catch (err) {
    console.error('Error enviando email de aviso (no afecta al guardado):', err);
  }
}

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

    // El email de aviso no debe bloquear ni romper la respuesta si falla
    await sendNotificationEmail(
      `🎯 Nueva solicitud de demo — ${empresa}`,
      `
        <h2>Nueva solicitud de demo</h2>
        <p><strong>Nombre:</strong> ${nombre} ${apellidos}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Empresa:</strong> ${empresa}</p>
        <p><strong>Tamaño de equipo:</strong> ${tamano_equipo}</p>
        <p><strong>Rol:</strong> ${rol}</p>
        <p><strong>Módulo de interés:</strong> ${modulo_interes}</p>
        ${reto ? `<p><strong>Reto que quiere resolver:</strong> ${reto}</p>` : ''}
      `
    );

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('submit-demo.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
