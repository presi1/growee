/**
 * Growee — Netlify Function: /.netlify/functions/route-visitor
 * ══════════════════════════════════════════════════════════
 * Recibe la pregunta escrita por un visitante de la web (no un cliente ya
 * dentro del producto — esto es para gente navegando la web pública) y usa
 * un modelo barato y rápido (Haiku) para: 1) darle una respuesta breve y
 * útil, y 2) sugerir a qué sección del sitio conviene llevarle.
 *
 * Este widget es solo un ayudante de navegación de la web pública — no
 * tiene memoria entre mensajes ni acceso a las conversaciones reales del
 * producto (eso vive en chat.mjs, con autenticación real).
 *
 * Variables de entorno necesarias:
 *   ANTHROPIC_API_KEY
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const DESTINOS_VALIDOS = {
  demo: 'Solicitar una demo',
  recursos: 'Ver guías gratuitas',
  precios: 'Ver precios y preguntas frecuentes',
  'como-funciona': 'Ver cómo funciona el proceso',
  'seguridad-rgpd': 'Ver seguridad y RGPD',
  casos: 'Ver casos de éxito',
  'prod-bienestar': 'Ver el módulo de Apoyo Emocional',
  'prod-coaching': 'Ver el módulo de Coaching',
  'prod-rrhh': 'Ver el Panel de RRHH',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { pregunta } = JSON.parse(event.body);
    if (!pregunta || !pregunta.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta la pregunta' }) };
    }

    const listaDestinos = Object.entries(DESTINOS_VALIDOS)
      .map(([id, desc]) => `- "${id}": ${desc}`)
      .join('\n');

    const prompt = `Eres el asistente de navegación de la web pública de Growee (una plataforma de bienestar y coaching para empresas — no eres el producto en sí, solo ayudas a la gente a encontrar la parte de la web que necesita).

Un visitante de la web ha escrito esto: "${pregunta}"

Responde SOLO con JSON válido, sin texto antes ni después, sin bloques de código, con este formato exacto:
{"respuesta": "una respuesta breve, cálida y útil de máximo 2 frases, respondiendo de verdad a su duda", "destino": "uno de los siguientes ids exactos, el que mejor encaje, o null si ninguno encaja bien"}

Los destinos disponibles son:
${listaDestinos}

Si la pregunta es sobre precio, coste o planes → "precios". Si pregunta cómo empezar o el proceso de activación → "como-funciona". Si pregunta por privacidad, RGPD o confidencialidad → "seguridad-rgpd". Si quiere ver ejemplos de contenido o metodologías gratis → "recursos". Si parece un cliente potencial listo para avanzar (quiere contratar, probar, hablar con ventas) → "demo". Si pregunta específicamente por el módulo de bienestar emocional → "prod-bienestar", por coaching → "prod-coaching", por el panel de RRHH → "prod-rrhh". Si pregunta por resultados o clientes reales → "casos".`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('Error clasificando la pregunta:', await res.text());
      return { statusCode: 502, body: JSON.stringify({ error: 'No se pudo procesar la pregunta' }) };
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // Nos aseguramos de que el destino sea uno real, nunca uno inventado por el modelo
    const destinoValido = DESTINOS_VALIDOS[parsed.destino] ? parsed.destino : null;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        respuesta: parsed.respuesta || 'No he podido entender bien tu pregunta — ¿puedes reformularla?',
        destino: destinoValido,
        destino_label: destinoValido ? DESTINOS_VALIDOS[destinoValido] : null,
      }),
    };
  } catch (err) {
    console.error('route-visitor.js error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno' }) };
  }
};
