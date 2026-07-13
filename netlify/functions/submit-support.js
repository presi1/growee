/**
 * Growee — Netlify Function: /.netlify/functions/submit-support
 * ══════════════════════════════════════════════════════════
 * Recibe el formulario de "Ayuda y soporte", lo guarda en Supabase
 * (tabla support_requests), y manda un email de aviso vía Resend.
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

    await sendNotificationEmail(
      `💬 Nueva solicitud de soporte${nombre ? ' — ' + nombre : ''}`,
      `
        <h2>Nueva solicitud de ayuda y soporte</h2>
        <p><strong>Nombre:</strong> ${nombre || '(no indicado)'}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Módulo:</strong> ${modulo || '(no indicado)'}</p>
        <p><strong>Mensaje:</strong></p>
        <p>${mensaje.replace(/\n/g, '<br>')}</p>
      `
    );

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('submit-support.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
