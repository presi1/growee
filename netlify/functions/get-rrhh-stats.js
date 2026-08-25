/**
 * Growee — Netlify Function: /.netlify/functions/get-rrhh-stats
 * ══════════════════════════════════════════════════════════
 * Devuelve los datos agregados de una empresa para el Panel de RRHH:
 * empleados activos, mensajes, reparto por módulo, tendencia y temas más
 * consultados. NUNCA devuelve contenido de conversaciones individuales —
 * todo el cálculo se hace dentro de la función SQL get_company_stats.
 *
 * Requiere sesión verificada (header Authorization: Bearer <token>) —
 * el email se toma del token, nunca del body, y solo entonces se
 * comprueba en company_admins que esa persona es realmente admin.
 * Antes, cualquiera con el email de un admin (sin necesitar su
 * contraseña) podía pedir estas estadísticas directamente.
 *
 * RBAC granular (backlog punto 7): si el admin tiene admin_level='team',
 * las estadísticas se filtran a solo su equipo (se pasa p_team a la
 * función SQL) — nunca ve el resto de la empresa. Un admin_level='company'
 * (o cualquier admin dado de alta antes de este cambio, que por defecto
 * quedó en 'company') sigue viendo todo, sin cambios de comportamiento.
 *
 * Variables de entorno necesarias (las mismas de siempre):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { verifyAuth } = require('./_verify-auth.js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const auth = await verifyAuth(event);
  if (!auth.ok) {
    return { statusCode: auth.statusCode, body: JSON.stringify({ error: auth.error }) };
  }

  try {
    const email = auth.email; // verificado por el token — nunca confiar en el body para esto

    // 1. Comprobar que este email es admin de verdad, de qué empresa y con qué nivel
    const adminUrl = `${SUPABASE_URL}/rest/v1/company_admins?email=eq.${encodeURIComponent(email)}&select=company,admin_level,team`;
    const adminRes = await fetch(adminUrl, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!adminRes.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Error comprobando permisos' }) };
    }

    const adminRows = await adminRes.json();
    if (adminRows.length === 0) {
      return { statusCode: 403, body: JSON.stringify({ error: 'No tienes acceso a ningún panel de RRHH' }) };
    }

    const company = adminRows[0].company;
    const adminLevel = adminRows[0].admin_level || 'company';
    const team = adminRows[0].team || null;

    // 2. Pedir los agregados de esa empresa (o solo del equipo, si adminLevel='team') a la función SQL
    const rpcBody = { p_company: company };
    if (adminLevel === 'team' && team) rpcBody.p_team = team;

    const statsRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_company_stats`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(rpcBody),
    });

    if (!statsRes.ok) {
      const errText = await statsRes.text();
      console.error('Error obteniendo estadísticas:', errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'No se pudieron obtener los datos' }) };
    }

    const stats = await statsRes.json();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, adminLevel, team, stats }),
    };
  } catch (err) {
    console.error('get-rrhh-stats.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
