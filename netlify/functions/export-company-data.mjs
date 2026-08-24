/**
 * Growee — Netlify Function: export-company-data
 * ══════════════════════════════════════════════════════════
 * Exportación de datos agregados para que RRHH los conecte a su propia
 * herramienta de BI (Looker, PowerBI, Google Sheets vía IMPORTDATA, etc.)
 * en vez de depender solo del panel dentro de Growee.
 *
 * Verifica el acceso exactamente igual que get-rrhh-stats.js — mismo
 * patrón, mismo nivel de seguridad, solo cambia el formato de salida.
 *
 * Requiere sesión verificada (header Authorization: Bearer <token>) —
 * el email se toma del token, nunca del body.
 *
 * USO:
 *   POST /.netlify/functions/export-company-data
 *   headers: { Authorization: "Bearer <access_token de la sesión>" }
 *   body: { "format": "csv", "days": 90 }
 *
 *   "format": "json" (por defecto) o "csv"
 *   "days": cuántos días hacia atrás exportar (por defecto 90)
 *
 * DÓNDE COLOCAR ESTE ARCHIVO: mismo directorio que el resto de funciones.
 *
 * Variables de entorno necesarias (ya existen, no hay que añadir ninguna):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { verifyAuth } from './_verify-auth.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function toCsv(rows) {
  const header = 'day,modulo,messages,active_users';
  const lines = rows.map(r => `${r.day},${r.modulo},${r.messages},${r.active_users}`);
  return [header, ...lines].join('\n');
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const auth = await verifyAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), { status: auth.statusCode });
  }
  const email = auth.email; // verificado por el token — nunca confiar en el body para esto

  let body;
  try {
    body = await req.json();
  } catch (e) {
    body = {};
  }

  const { format = 'json', days = 90 } = body;

  // 1. Comprobar que este email es admin de verdad, y de qué empresa — igual que get-rrhh-stats.js
  const adminUrl = `${SUPABASE_URL}/rest/v1/company_admins?email=eq.${encodeURIComponent(email)}&select=company`;
  const adminRes = await fetch(adminUrl, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!adminRes.ok) {
    return new Response(JSON.stringify({ error: 'Error comprobando permisos' }), { status: 500 });
  }
  const adminRows = await adminRes.json();
  if (adminRows.length === 0) {
    return new Response(JSON.stringify({ error: 'No tienes acceso a ningún panel de RRHH' }), { status: 403 });
  }
  const company = adminRows[0].company;

  // 2. Pedir la exportación diaria a la función SQL
  const exportRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_company_daily_export`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_company: company, p_days: days }),
  });
  if (!exportRes.ok) {
    console.error('Error obteniendo exportación:', await exportRes.text());
    return new Response(JSON.stringify({ error: 'No se pudieron obtener los datos' }), { status: 502 });
  }
  const rows = await exportRes.json();

  if (format === 'csv') {
    return new Response(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="growee-export-${company}.csv"`,
      },
    });
  }

  return new Response(JSON.stringify({ company, rows }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
