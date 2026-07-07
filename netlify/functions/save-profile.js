/**
 * Growee — Netlify Function: /.netlify/functions/save-profile
 * ══════════════════════════════════════════════════════════
 * Guarda (crea o actualiza) el perfil editable de un usuario: nombre,
 * apellidos, empresa y rol. El email es la clave y no se puede cambiar
 * desde aquí (es el identificador de la cuenta).
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { email, name, surname, company, role } = JSON.parse(event.body);
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta email' }) };
    }

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
