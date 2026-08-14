/**
 * Growee — Netlify Scheduled Function: weekly-digest
 * ══════════════════════════════════════════════════════════
 * Cada lunes envía a cada admin de RRHH un resumen por email de la semana
 * de su empresa — sin depender de que entren al panel para verlo.
 *
 * Toda la lógica de "quién recibe qué" vive en la función SQL
 * get_weekly_digest_recipients (ya creada en Supabase), que a su vez
 * reutiliza get_company_stats — así el digest siempre muestra exactamente
 * los mismos números que el panel, nunca datos calculados por separado.
 *
 * DÓNDE COLOCAR ESTE ARCHIVO: mismo directorio que remind-inactive.mjs y
 * el resto de funciones. Al hacer push, Netlify programa sola la función
 * según el "schedule" del final del archivo.
 *
 * Variables de entorno necesarias (ya existen, no hay que añadir ninguna):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'Growee <notificaciones@growee.es>'; // ajusta al remitente verificado en Resend

async function getRecipients() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_weekly_digest_recipients`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    console.error('Error obteniendo destinatarios del digest:', await res.text());
    return [];
  }
  return res.json();
}

function statRow(label, value) {
  return `<tr><td style="padding:6px 0;color:#555;font-size:14px">${label}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0D1B2A;font-size:14px">${value}</td></tr>`;
}

function buildDigestHtml(company, stats) {
  const topics = (stats.topic_categories || []).slice(0, 3)
    .map(t => t.categoria).join(' · ') || 'Sin datos suficientes todavía';

  let benchmarkLine = '';
  if (typeof stats.wellbeing_index === 'number' && typeof stats.benchmark_avg_participation_index === 'number' && (stats.benchmark_companies_count || 0) >= 3) {
    const diff = stats.wellbeing_index - stats.benchmark_avg_participation_index;
    const txt = diff > 0 ? `${diff} puntos por encima` : diff < 0 ? `${Math.abs(diff)} puntos por debajo` : 'igual';
    benchmarkLine = `<p style="font-size:13px;color:#666;margin-top:4px">${txt} de la media de empresas similares.</p>`;
  }

  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
      <p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.05em">Resumen semanal · ${company}</p>
      <h2 style="font-family:Georgia,serif;font-weight:400;margin:8px 0 20px">Cómo ha ido la semana en Growee</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
        ${statRow('Índice de participación', stats.wellbeing_index ?? '—')}
        ${statRow('Empleados activos esta semana', stats.active_week ?? 0)}
        ${statRow('Mensajes esta semana', stats.messages_week ?? 0)}
      </table>
      ${benchmarkLine}
      <p style="font-size:14px;color:#333;margin-top:20px"><strong>Temas más trabajados:</strong> ${topics}</p>
      <p style="margin:28px 0">
        <a href="https://growee.es" style="background:#52B788;color:#0D1B2A;padding:12px 24px;border-radius:50px;text-decoration:none;font-weight:700">Ver panel completo</a>
      </p>
      <p style="font-size:12px;color:#999">Todos los datos son agregados y anónimos — nunca incluyen contenido de conversaciones individuales.</p>
    </div>
  `;
}

async function sendDigestEmail(adminEmail, company, stats) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: adminEmail,
      subject: `Resumen semanal de Growee — ${company}`,
      html: buildDigestHtml(company, stats),
    }),
  });
  if (!res.ok) {
    console.error(`Error enviando digest a ${adminEmail}:`, await res.text());
    return false;
  }
  return true;
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    console.error('Faltan variables de entorno necesarias para weekly-digest');
    return new Response('Faltan variables de entorno', { status: 500 });
  }

  const recipients = await getRecipients();
  let sent = 0;

  for (const r of recipients) {
    const ok = await sendDigestEmail(r.admin_email, r.company, r.stats || {});
    if (ok) sent++;
  }

  console.log(`weekly-digest: ${sent}/${recipients.length} digests enviados`);
  return new Response(JSON.stringify({ candidates: recipients.length, sent }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// Cada lunes a las 8:00 UTC.
export const config = {
  schedule: '0 8 * * 1',
};
