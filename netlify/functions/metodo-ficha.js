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

    const prompt = `Genera una ficha explicativa completa y con nivel profesional de la siguiente metodología o modelo, usado en el contexto de ${esCoaching ? 'coaching profesional' : 'bienestar y apoyo emocional'} laboral: "${nombreMetodo}"

Esta ficha debe funcionar como un documento de referencia serio que alguien pueda guardar y consultar, no como un resumen superficial. Responde SOLO con JSON válido, sin texto antes ni después, sin bloques de código, con este formato exacto:

{
  "titulo": "nombre de la metodología, tal cual se conoce",
  "autor": "autor(es) o corriente de origen, con un poco de contexto sobre cuándo y por qué se desarrolló, en 1-2 frases (deja vacío si no se conoce con certeza)",
  "que_es": "explicación completa de qué es la metodología y la idea central en la que se basa, en 4-6 frases con profundidad real, no una definición de diccionario",
  "cuando_se_aplica": "en qué situaciones concretas del trabajo tiene sentido usarla, con 2-3 ejemplos de contextos reales donde encaja bien, en 4-6 frases",
  "pasos": ["paso o principio clave 1, desarrollado en 2-3 frases explicando qué implica en la práctica y por qué importa", "paso o principio clave 2, con el mismo nivel de desarrollo", "..."]
}

Reglas importantes:
- Cada paso o principio debe estar desarrollado con suficiente profundidad para que alguien lo entienda y lo pueda aplicar sin necesitar más contexto, no una frase suelta de titular.
- Entre 4 y 6 elementos en "pasos", cada uno sustancioso.
- No inventes datos que no conozcas con razonable certeza — si no conoces el autor exacto, deja "autor" como cadena vacía en vez de inventarlo.
- El conjunto de la ficha debe sentirse como un documento completo de una o dos páginas, no como una tarjeta resumen.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1800,
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
