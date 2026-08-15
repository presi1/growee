/**
 * Growee — Netlify Scheduled Function: weekly-digest
 * ══════════════════════════════════════════════════════════
 * Cada lunes hace dos cosas:
 *   1. Envía a cada admin de RRHH un resumen por email de la semana de su
 *      empresa — sin depender de que entren al panel para verlo.
 *   2. Guarda una foto del índice de participación de cada empresa y, si
 *      alguna ha caído o ha subido mucho frente a hace ~4 semanas, os manda
 *      a VOSOTROS (nunca a la empresa cliente) un único aviso interno con
 *      ambas listas — para poder contactar de forma proactiva, tanto para
 *      resolver un problema como para reforzar lo que está funcionando.
 *
 * Toda la lógica de "quién recibe qué" y "quién se mueve mucho" vive en
 * funciones SQL ya creadas en Supabase (get_weekly_digest_recipients,
 * record_company_index_snapshots, get_at_risk_companies,
 * get_improved_companies) — este archivo solo las llama y envía los
 * emails correspondientes vía Resend.
 *
 * DÓNDE COLOCAR ESTE ARCHIVO: mismo directorio que remind-inactive.mjs y
 * el resto de funciones. Al hacer push, Netlify programa sola la función
 * según el "schedule" del final del archivo. Si ya tenías una versión
 * anterior de weekly-digest.mjs, sustitúyela por esta.
 *
 * Variables de entorno necesarias (ya existen, no hay que añadir ninguna):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 *   NOTIFICATION_EMAIL   (tu propio email, para el aviso interno)
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;
const FROM_EMAIL = 'Growee <notificaciones@growee.es>'; // ajusta al remitente verificado en Resend

async function callRpc(fnName, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    console.error(`Error llamando a ${fnName}:`, await res.text());
    return null;
  }
  return res.json();
}

// ── Digest a cada admin de RRHH ──────────────────────────────

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

async function sendDigestEmails() {
  const recipients = await callRpc('get_weekly_digest_recipients') || [];
  let sent = 0;

  for (const r of recipients) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: r.admin_email,
        subject: `Resumen semanal de Growee — ${r.company}`,
        html: buildDigestHtml(r.company, r.stats || {}),
      }),
    });
    if (res.ok) sent++;
    else console.error(`Error enviando digest a ${r.admin_email}:`, await res.text());
  }

  return { candidates: recipients.length, sent };
}

// ── Aviso interno: caídas Y mejoras notables ─────────────────

function movementTable(companies, colorForValue) {
  return companies.map(c => `
    <tr>
      <td style="padding:8px 0;font-weight:700;color:#0D1B2A">${c.company}</td>
      <td style="padding:8px 0;text-align:right;color:#666">${c.index_then} → ${c.index_now}</td>
      <td style="padding:8px 0;text-align:right;color:${colorForValue};font-weight:700">${c.delta}</td>
    </tr>
  `).join('');
}

function buildMovementAlertHtml(atRisk, improved) {
  const riskRows = atRisk.map(c => ({ ...c, delta: `-${c.drop} pts` }));
  const improvedRows = improved.map(c => ({ ...c, delta: `+${c.improvement} pts` }));

  const riskSection = riskRows.length ? `
    <p style="font-size:13px;color:#C25B52;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-top:24px">⚠️ Caída notable</p>
    <table style="width:100%;border-collapse:collapse">${movementTable(riskRows, '#C25B52')}</table>
  ` : '';

  const improvedSection = improvedRows.length ? `
    <p style="font-size:13px;color:#52B788;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-top:24px">📈 Mejora notable</p>
    <table style="width:100%;border-collapse:collapse">${movementTable(improvedRows, '#52B788')}</table>
  ` : '';

  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
      <p style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Aviso interno — solo para ti</p>
      <h2 style="font-family:Georgia,serif;font-weight:400;margin:8px 0 4px">Movimientos notables esta semana</h2>
      <p style="font-size:13px;color:#666">Comparado con hace ~4 semanas.</p>
      ${riskSection}
      ${improvedSection}
      <p style="font-size:13px;color:#666;margin-top:24px">Las caídas pueden valer la pena contactarlas antes de la renovación. Las mejoras son un buen momento para reforzar la relación — pedir feedback, ofrecer un caso de éxito, o simplemente reconocerlo.</p>
    </div>
  `;
}

async function checkCompanyMovement() {
  await callRpc('record_company_index_snapshots'); // primero, siempre guarda la foto de hoy

  if (!NOTIFICATION_EMAIL) {
    console.log('NOTIFICATION_EMAIL no configurado — se omite la comprobación de movimiento.');
    return { checked: false };
  }

  const [atRisk, improved] = await Promise.all([
    callRpc('get_at_risk_companies', { p_threshold: 15, p_weeks_back: 4 }),
    callRpc('get_improved_companies', { p_threshold: 15, p_weeks_back: 4 }),
  ]);
  const atRiskList = atRisk || [];
  const improvedList = improved || [];

  if (atRiskList.length === 0 && improvedList.length === 0) {
    return { checked: true, atRisk: 0, improved: 0 };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: NOTIFICATION_EMAIL,
      subject: `${atRiskList.length ? '⚠️' : '📈'} Movimientos de participación esta semana`,
      html: buildMovementAlertHtml(atRiskList, improvedList),
    }),
  });
  if (!res.ok) console.error('Error enviando aviso interno de movimiento:', await res.text());

  return { checked: true, atRisk: atRiskList.length, improved: improvedList.length };
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY) {
    console.error('Faltan variables de entorno necesarias para weekly-digest');
    return new Response('Faltan variables de entorno', { status: 500 });
  }

  const digestResult = await sendDigestEmails();
  const movementResult = await checkCompanyMovement();

  console.log(`weekly-digest: ${digestResult.sent}/${digestResult.candidates} digests enviados. Movimiento: ${JSON.stringify(movementResult)}`);
  return new Response(JSON.stringify({ digest: digestResult, movement: movementResult }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// Cada lunes a las 8:00 UTC.
export const config = {
  schedule: '0 8 * * 1',
};
