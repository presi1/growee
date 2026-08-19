/**
 * Growee — Netlify Function: /.netlify/functions/metodo-ficha
 * ══════════════════════════════════════════════════════════
 * Genera una ficha explicativa genérica de una metodología o modelo
 * (qué es, cuándo se aplica, pasos o principios clave), sin depender
 * del contexto de ninguna conversación concreta — pensada para
 * convertirse en un PDF de referencia reutilizable. El resumen
 * aplicado a la sesión de la persona sigue viviendo en
 * summarize-session.js; esta función es su complemento genérico.
 *
 * Variables de entorno necesarias (las mismas de siempre):
 *   ANTHROPIC_API_KEY
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { nombreMetodo, modulo } = JSON.parse(event.body);

    if (!nombreMetodo || typeof nombreMetodo !== 'string') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta el nombre de la metodología' }) };
    }

    const esCoaching = modulo === 'coaching';

    const prompt = `Genera una ficha explicativa breve y genérica de la siguiente metodología o modelo, usado en el contexto de ${esCoaching ? 'coaching profesional' : 'bienestar y apoyo emocional'} laboral: "${nombreMetodo}"

Responde SOLO con JSON válido, sin texto antes ni después, sin bloques de código, con este formato exacto:

{
  "titulo": "nombre de la metodología, tal cual se conoce",
  "autor": "autor(es) o corriente de origen, en una frase breve (deja vacío si no se conoce con certeza)",
  "que_es": "explicación de qué es la metodología, en 2-3 frases claras",
  "cuando_se_aplica": "en qué situaciones tiene sentido usarla, en 2-3 frases",
  "pasos": ["paso o principio clave 1, en una frase", "paso o principio clave 2", "..."]
}

Máximo 6 elementos en "pasos". No inventes datos que no conozcas con razonable certeza — si no conoces el autor exacto, deja "autor" como cadena vacía en vez de inventarlo.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Error generando la ficha de metodología:', errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'No se pudo generar la ficha' }) };
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    console.error('metodo-ficha.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
