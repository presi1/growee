/**
 * Growee — Netlify Function: /.netlify/functions/submit-lead
 * ══════════════════════════════════════════════════════════
 * Recibe el email de alguien que ha desbloqueado una guía de Recursos,
 * lo guarda en Supabase (tabla content_leads), y manda un aviso vía Resend.
 *
 * Variables de entorno necesarias (las mismas de siempre):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY       — opcional, si no está puesta simplemente no avisa por email
 *   NOTIFICATION_EMAIL   — opcional
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;

async function sendNotificationEmail(subject, htmlBody) {
  if (!RESEND_API_KEY || !NOTIFICATION_EMAIL) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Growee <onboarding@resend.dev>',
        to: [NOTIFICATION_EMAIL],
        subject,
        html: htmlBody,
      }),
    });
    if (!res.ok) console.error('Error enviando email de aviso:', await res.text());
  } catch (err) {
    console.error('Error enviando email de aviso:', err);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { nombre, email, guia } = JSON.parse(event.body);

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta el email' }) };
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/content_leads`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nombre: nombre || null, email, guia: guia || null }),
    });

    if (!res.ok) {
      console.error('Error guardando el lead:', await res.text());
      return { statusCode: 502, body: JSON.stringify({ error: 'No se pudo guardar' }) };
    }

    await sendNotificationEmail(
      `📖 Nuevo lead de contenido — ${guia || 'guía'}`,
      `<h2>Alguien ha desbloqueado una guía</h2><p><strong>Nombre:</strong> ${nombre || '(no indicado)'}</p><p><strong>Email:</strong> ${email}</p><p><strong>Guía:</strong> ${guia || '(no indicada)'}</p>`
    );

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('submit-lead.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
