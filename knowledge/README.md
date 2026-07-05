# Growee — Base de conocimiento (knowledge base)

Este repositorio contiene los fragmentos curados que alimentarán el sistema RAG (Retrieval-Augmented Generation) de Growee: cada fragmento es una síntesis original de una metodología o técnica, citando siempre su autor/origen, pensada para que la IA la recupere y la cite de forma natural en conversación.

## Estructura de carpetas

```
knowledge/
  bienestar/        → fragmentos del módulo Apoyo Emocional
  coaching/          → fragmentos del módulo Coaching (pendiente de empezar)
```

Un archivo `.md` por fragmento. El nombre de archivo usa `kebab-case` descriptivo (ej. `tcc-catastrofizacion.md`).

## Formato de cada fragmento

Cada archivo empieza con una cabecera YAML (front matter) seguida de las secciones en Markdown:

```yaml
---
modulo: bienestar | coaching
metodologia: Nombre corto de la técnica
origen: Autor(es) y marco teórico de origen
dispara_cuando: [lista, de, señales, o, situaciones, que activan este fragmento]
fragmento_relacionado: nombre-de-archivo-sin-extension   # opcional, si hay un fragmento "padre" o hermano
---
```

Secciones del cuerpo (siempre en este orden):
1. **Metodología / técnica** — nombre.
2. **Autor y origen** — de dónde viene, brevemente.
3. **Cuándo se aplica** — qué dice o qué patrón muestra la persona para que este fragmento sea relevante.
4. **Síntesis en tus palabras** — la explicación real, siempre redacción original (nunca copiada ni parafraseada de cerca de una fuente concreta — ver regla legal abajo).
5. **Cómo se ofrece en conversación** — un ejemplo de diálogo mostrando cómo Growee introduciría esta técnica nombrándola explícitamente.
6. **Notas para quien mantenga este contenido** — matices de mantenimiento, cuándo se solapa con otros fragmentos, etc. (esta sección no se sube a producción / no se usa como contexto para la IA, es solo para nosotros).

## Proceso de validación de contenido

**Estado actual (a fecha de esta nota): los 32 fragmentos están marcados como `"verificado"` para poder probar el pipeline técnico de punta a punta — pero esa verificación es interna (Ferran), NO una revisión clínica real.** El campo `revisado_por` de cada fragmento en `manifest.json` lo deja explícito para que no se olvide. Antes de lanzar Growee a producción con usuarios reales, hace falta pasar el contenido por la revisión clínica descrita abajo.

Flujo previsto para cuando se retome la validación real:
1. **Redacción**: estudiantes de psicología (idealmente vía convenio de prácticas con una facultad, no como coste fijo) redactan siguiendo la plantilla de este README, partiendo siempre de conocimiento general y público — nunca de un resumen o artículo concreto de terceros.
2. **Revisión clínica**: un psicólogo colegiado revisa cada fragmento en dos planos: (a) corrección clínica del contenido, (b) idoneidad para entregarse vía chat de IA sin supervisión en tiempo real (matices de cuándo derivar, nivel de directividad del lenguaje, etc.).
3. **Cambio de estado**: al aprobarse de verdad, se actualiza en `manifest.json`: `estado: "verificado"`, `revisado_por: "[nombre y nº de colegiado]"`, `fecha_revision: "YYYY-MM-DD"` — sustituyendo la marca de revisión interna actual.
4. Solo entonces debería considerarse el contenido apto para usuarios reales, no solo para pruebas técnicas.

## Regla legal — importante

Todo el contenido de este repositorio debe partir de **conocimiento general y público** sobre la metodología (lo que se encuentra en múltiples manuales, cursos o artículos, no en una única fuente con derechos de autor). Nunca partir de un resumen o artículo concreto (Blinkist, un blog, un libro específico) para reescribirlo o parafrasearlo — la paráfrasis cercana de una fuente concreta sigue siendo una infracción de copyright aunque ninguna frase sea literalmente idéntica. Ver conversación de referencia sobre este tema para más detalle si hace falta revisitarlo.

## Próximos pasos técnicos (pendiente)

1. Script de ingestión: lee cada `.md`, extrae front matter + cuerpo, genera embeddings (Voyage AI) y los sube a Supabase (pgvector).
2. Función `chat.js` en Netlify: en cada mensaje, embebe la pregunta del usuario, busca los fragmentos más similares en Supabase, y los añade como contexto al `system prompt` de esa llamada.
3. Repetir para el módulo Coaching (GROW, SBI, Liderazgo Situacional...) — aún no empezado.
