/**
 * Growee — Netlify Function: /.netlify/functions/get-rrhh-stats
 * ══════════════════════════════════════════════════════════
 * Devuelve los datos agregados de una empresa para el Panel de RRHH:
 * empleados activos, mensajes, reparto por módulo, tendencia y temas más
 * consultados. NUNCA devuelve contenido de conversaciones individuales —
 * todo el cálculo se hace dentro de la función SQL get_company_stats.
 *
 * Antes de devolver nada, comprueba en company_admins que el email que
 * pide los datos es realmente administrador de esa empresa.
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
    const { email } = JSON.parse(event.body);
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta email' }) };
    }

    // 1. Comprobar que este email es admin de verdad, y de qué empresa
    const adminUrl = `${SUPABASE_URL}/rest/v1/company_admins?email=eq.${encodeURIComponent(email.toLowerCase())}&select=company`;
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

    // 2. Pedir los agregados de esa empresa a la función SQL
    const statsRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_company_stats`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_company: company }),
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
      body: JSON.stringify({ company, stats }),
    };
  } catch (err) {
    console.error('get-rrhh-stats.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
