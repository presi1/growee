/**
 * Growee — Netlify Scheduled Function: remind-inactive
 * ══════════════════════════════════════════════════════════
 * Se ejecuta sola cada día (ver "config" al final del archivo) y envía un
 * email de recordatorio a las personas que:
 *   1. Han activado el opt-in de recordatorios en su perfil, y
 *   2. Llevan varios días sin escribir ni un mensaje al chat, y
 *   3. No han recibido ya un recordatorio en ese mismo periodo (para no
 *      machacar a nadie con un email diario).
 *
 * Toda la lógica de "quién es candidato" vive en la función SQL
 * get_inactive_opted_in_users (ya creada en Supabase) — este archivo solo
 * llama a esa función, envía los emails vía Resend, y marca a cada persona
 * como avisada con mark_reminder_sent.
 *
 * DÓNDE COLOCAR ESTE ARCHIVO: en el mismo directorio donde ya tienes el
 * resto de funciones (junto a chat.mjs, get-rrhh-stats.js, etc.). Al hacer
 * push, Netlify detecta el "schedule" de abajo y la programa sola — no
 * hace falta configurar nada más en netlify.toml.
 *
 * Variables de entorno necesarias (ya existen en tu proyecto, no hay que
 * añadir ninguna nueva):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 *
 * Parámetro ajustable: cuántos días de inactividad disparan el aviso.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const INACTIVE_DAYS = 5; // cámbialo si quieres avisar antes o después
const FROM_EMAIL = 'Growee <notificaciones@growee.es>'; // ajusta al remitente verificado en Resend

async function getInactiveOptedInUsers() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_inactive_opted_in_users`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_inactive_days: INACTIVE_DAYS }),
  });
  if (!res.ok) {
    console.error('Error obteniendo usuarios inactivos:', await res.text());
    return [];
  }
  return res.json();
}

async function markReminderSent(email) {
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_reminder_sent`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_email: email }),
  }).catch((e) => console.error(`No se pudo marcar como avisado a ${email}:`, e));
}

function buildEmailHtml(name) {
  const greeting = name ? `Hola ${name},` : 'Hola,';
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
      <p>${greeting}</p>
      <p>Hace unos días que no pasas por Growee. No pasa nada — solo queríamos recordarte que el chat sigue ahí cuando lo necesites, sin compromiso ni presión.</p>
      <p style="margin:28px 0">
        <a href="https://growee.es" style="background:#52B788;color:#0D1B2A;padding:12px 24px;border-radius:50px;text-decoration:none;font-weight:700">Volver a Growee</a>
      </p>
      <p style="font-size:13px;color:#666">Si prefieres no recibir más avisos como este, puedes desactivarlos desde tu perfil dentro de la plataforma.</p>
    </div>
  `;
}

async function sendReminderEmail(user) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: user.user_email,
      subject: 'Te echamos de menos por Growee',
      html: buildEmailHtml(user.name),
    }),
  });
  if (!res.ok) {
    console.error(`Error enviando email a ${user.user_email}:`, await res.text());
    return false;
  }
  return true;
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    console.error('Faltan variables de entorno necesarias para remind-inactive');
    return new Response('Faltan variables de entorno', { status: 500 });
  }

  const users = await getInactiveOptedInUsers();
  let sent = 0;

  for (const user of users) {
    const ok = await sendReminderEmail(user);
    if (ok) {
      await markReminderSent(user.user_email);
      sent++;
    }
  }

  console.log(`remind-inactive: ${sent}/${users.length} recordatorios enviados`);
  return new Response(JSON.stringify({ candidates: users.length, sent }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// Se ejecuta cada día a las 9:00 UTC. Sintaxis cron estándar de Netlify Scheduled Functions.
export const config = {
  schedule: '0 9 * * *',
};
