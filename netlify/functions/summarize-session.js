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

Sintetiza esta conversación en un resumen estructurado, pensado para que la persona se lo lleve como documento de referencia. Responde SOLO con JSON válido, sin texto antes ni después, sin bloques de código, con este formato exacto:

{
  "titulo": "un título breve de 4-8 palabras que resuma el tema central de la conversación",
  "metodologias": ["Nombre de la metodología — Autor: una frase de qué se aplicó y por qué", "..."],
  "estrategias": ["Un consejo o estrategia concreta mencionada, en una frase clara", "..."],
  "proximos_pasos": ["Un paso concreto que quedó pendiente o acordado, en una frase clara", "..."]
}

Si alguna de las tres listas no tiene contenido real en la conversación, devuélvela como array vacío — no inventes nada que no se haya dicho. Máximo 5 elementos por lista, los más relevantes.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
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
