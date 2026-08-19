/**
 * Growee — Netlify Function: /.netlify/functions/summarize-session
 * ══════════════════════════════════════════════════════════
 * Recibe el historial de la sesión actual (no toda la conversación
 * histórica, solo la que se ve en pantalla en ese momento) y le pide a
 * Claude que la sintetice en tres bloques: metodologías citadas, consejos
 * y estrategias clave, y próximos pasos o compromisos — pensado para
 * convertirse después en un PDF de resumen, no para sustituir el
 * historial completo (que se sigue pudiendo descargar tal cual).
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
    const { messages, modulo } = JSON.parse(event.body);

    if (!Array.isArray(messages) || messages.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No hay conversación que resumir' }) };
    }

    // Solo necesitamos el texto — si algún mensaje llevaba imagen, nos quedamos con la parte de texto
    const transcript = messages.map((m) => {
      const role = m.role === 'assistant' ? 'Growee' : 'Persona';
      let text = m.content;
      if (Array.isArray(text)) {
        const t = text.find((b) => b.type === 'text');
        text = t ? t.text : '[imagen]';
      }
      return `${role}: ${text}`;
    }).join('\n\n');

    const esCoaching = modulo === 'coaching';

    const prompt = `Aquí tienes una conversación de ${esCoaching ? 'coaching profesional' : 'apoyo emocional'} entre una persona y un asistente de IA (Growee).

${transcript}

Sintetiza esta conversación en un resumen estructurado y con nivel profesional, pensado para que la persona se lo lleve como documento de referencia serio, no como una lista de titulares. Responde SOLO con JSON válido, sin texto antes ni después, sin bloques de código, con este formato exacto:

{
  "titulo": "un título breve de 4-8 palabras que resuma el tema central de la conversación",
  "metodologias": ["Nombre de la metodología — Autor u origen: un desarrollo de 2-4 frases explicando en qué consiste la metodología, por qué se eligió para esta situación concreta y cómo se aplicó exactamente en la conversación", "..."],
  "estrategias": ["Un consejo o estrategia concreta, desarrollado en 2-3 frases: qué es exactamente, por qué funciona y cómo aplicarlo en la práctica — no una frase suelta sin contexto", "..."],
  "proximos_pasos": ["Un paso concreto que quedó pendiente o acordado, en 1-2 frases con detalle suficiente para saber exactamente qué hacer y por qué", "..."]
}

Reglas importantes:
- No inventes contenido que no se haya dicho en la conversación — si la conversación fue breve, es preferible tener menos elementos pero bien desarrollados, que muchos elementos vacíos o forzados.
- Cada elemento debe aportar valor real por sí solo, como si la persona lo leyera semanas después sin recordar la conversación: dale el contexto suficiente para que se entienda sin necesidad de haber estado presente.
- Evita frases telegráficas de una sola línea sin explicación — desarrolla cada punto con la profundidad de un documento profesional, no de una lista de la compra.
- Si alguna de las tres listas no tiene contenido real en la conversación, devuélvela como array vacío.
- Máximo 5 elementos por lista, los más relevantes y mejor fundamentados.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Error generando el resumen:', errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'No se pudo generar el resumen' }) };
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
    console.error('summarize-session.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
