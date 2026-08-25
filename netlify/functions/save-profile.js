/**
 * Growee — Netlify Function: /.netlify/functions/save-profile
 * ══════════════════════════════════════════════════════════
 * Guarda (crea o actualiza) el perfil editable de un usuario: nombre,
 * apellidos, empresa y rol. El email es la clave y no se puede cambiar
 * desde aquí (es el identificador de la cuenta).
 *
 * Requiere sesión verificada (header Authorization: Bearer <token>) — el
 * email se toma SIEMPRE del token, nunca del body. Antes de este cambio,
 * cualquiera podía sobrescribir el perfil de otra persona (incluida su
 * empresa asignada, lo que afecta a qué estadísticas de RRHH se le
 * atribuyen) solo conociendo o adivinando su email — mismo patrón que se
 * cerró antes en history.js, check-admin.js, get-rrhh-stats.js y
 * export-company-data.mjs.
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
  const email = auth.email; // verificado por el token — nunca confiar en el body para esto

  try {
    const { name, surname, company, role, team } = JSON.parse(event.body || '{}');

    const res = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?on_conflict=email`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        email,
        name: name || null,
        surname: surname || null,
        company: company || null,
        role: role || null,
        team: team || null,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Error guardando perfil:', errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'No se pudo guardar el perfil' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('save-profile.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
