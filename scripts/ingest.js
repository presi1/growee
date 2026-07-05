/**
 * Growee — script de ingestión de la base de conocimiento
 * ══════════════════════════════════════════════════════════
 * Lee knowledge/manifest.json, genera un embedding para cada fragmento con
 * estado "verificado" usando Voyage AI, y lo sube (upsert) a Supabase.
 *
 * Uso:
 *   node scripts/ingest.js
 *
 * Variables de entorno necesarias (ver .env.example):
 *   VOYAGE_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Ejecutar cada vez que se añada o apruebe ("verificado") un fragmento nuevo.
 * Los fragmentos en estado "borrador" se listan pero NO se suben — evita que
 * contenido sin revisión clínica llegue nunca a producción.
 */

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');
const MANIFEST_PATH = path.join(KNOWLEDGE_DIR, 'manifest.json');

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!VOYAGE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan variables de entorno. Revisa .env.example y expórtalas antes de ejecutar.');
  process.exit(1);
}

// Separa el front matter YAML (simple, sin dependencias externas) del cuerpo del fragmento.
function parseFragment(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw.trim() };
  const [, frontMatter, body] = match;
  const meta = {};
  frontMatter.split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // Nota: no parseamos listas [a, b, c] a fondo aquí — solo se usan como metadata
    // informativa (dispara_cuando), no como filtro de la query en producción.
    meta[key] = value;
  });
  return { meta, content: body.trim() };
}

async function getEmbedding(text) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: [text],
      model: 'voyage-3-lite',
      input_type: 'document',
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage AI error (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.data[0].embedding;
}

async function upsertChunk(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks?on_conflict=file`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(`Supabase error (${res.status}): ${await res.text()}`);
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  const verificados = manifest.fragments.filter((f) => f.estado === 'verificado');
  const borradores = manifest.fragments.filter((f) => f.estado !== 'verificado');

  console.log(`Fragmentos totales: ${manifest.fragments.length}`);
  console.log(`  Verificados (se van a subir): ${verificados.length}`);
  console.log(`  En borrador (se ignoran):     ${borradores.length}`);
  if (borradores.length > 0) {
    console.log('  → Pendientes de revisión clínica:', borradores.map((f) => f.file).join(', '));
  }

  for (const frag of verificados) {
    const fullPath = path.join(KNOWLEDGE_DIR, frag.file);
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const { content } = parseFragment(raw);

    console.log(`Procesando: ${frag.file}...`);
    const embedding = await getEmbedding(content);

    await upsertChunk({
      file: frag.file,
      modulo: frag.modulo,
      metodologia: frag.metodologia,
      origen: frag.origen || null,
      tipo: frag.tipo || null,
      fragmento_relacionado: frag.fragmento_relacionado || null,
      content,
      embedding,
      estado: frag.estado,
      revisado_por: frag.revisado_por || null,
      fecha_revision: frag.fecha_revision || null,
    });

    console.log(`  ✓ Subido a Supabase`);
  }

  console.log('\nIngestión completa.');
}

main().catch((err) => {
  console.error('Error en la ingestión:', err);
  process.exit(1);
});
