/**
 * Growee — Netlify Function: /.netlify/functions/bulk-add-employees
 * ══════════════════════════════════════════════════════════
 * Recibe una lista de empleados (nombre + email) desde el Panel de RRHH,
 * y crea/actualiza su perfil en user_profiles con la empresa correcta ya
 * asignada — así, cuando entren por primera vez con el enlace mágico, no
 * pasan por la pantalla de "cuéntanos sobre ti" y sus mensajes quedan bien
 * etiquetados para las estadísticas agregadas desde el primer día.
 *
 * Antes de nada, comprueba en company_admins que quien hace la petición es
 * admin de verdad — igual que get-rrhh-stats.js.
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
    const { adminEmail, employees } = JSON.parse(event.body);

    if (!adminEmail || !Array.isArray(employees) || employees.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos: adminEmail o la lista de empleados' }) };
    }
    if (employees.length > 2000) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Demasiadas filas en un solo CSV (máximo 2000). Divídelo en varios.' }) };
    }

    // 1. Comprobar que quien sube el CSV es admin de verdad, y de qué empresa
    const adminUrl = `${SUPABASE_URL}/rest/v1/company_admins?email=eq.${encodeURIComponent(adminEmail.toLowerCase())}&select=company`;
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
      return { statusCode: 403, body: JSON.stringify({ error: 'No tienes permisos de administrador' }) };
    }
    const company = adminRows[0].company;

    // 2. Validar y limpiar cada fila
    const valid = [];
    const invalid = [];
    const seen = new Set();
    for (const row of employees) {
      const email = (row.email || '').trim().toLowerCase();
      const name = (row.name || '').trim();
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailOk) {
        invalid.push(row.email || '(vacío)');
        continue;
      }
      if (seen.has(email)) continue; // fila duplicada dentro del propio CSV
      seen.add(email);
      valid.push({ email, name: name || null, company, updated_at: new Date().toISOString() });
    }

    if (valid.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Ninguna fila tenía un email válido', invalidCount: invalid.length }) };
    }

    // 3. Guardar en Supabase de una sola vez (upsert: si ya existía el email, actualiza; si no, lo crea)
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=email`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(valid),
    });

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error('Error dando de alta empleados:', errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'No se pudieron guardar los empleados' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ added: valid.length, invalid: invalid.length, invalidEmails: invalid.slice(0, 10) }),
    };
  } catch (err) {
    console.error('bulk-add-employees.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
