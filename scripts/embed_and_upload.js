/**
 * embed_and_upload.js — Embed chunks + upload to Cloudflare Vectorize & KV
 *
 * Prerequisites:
 *   1. npx wrangler vectorize create tisza-program-chunks --dimensions 1536 --metric cosine
 *   2. npx wrangler kv:namespace create TISZA_STORE
 *   3. Update wrangler.toml with the KV namespace ID
 *   4. Set OPENAI_API_KEY in .dev.vars or environment
 *
 * Usage:
 *   node scripts/embed_and_upload.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Config ───────────────────────────────────────────────────────────────────
const CHUNKS_PATH = path.join(__dirname, '..', 'public', 'data', 'chunks.json');
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100; // OpenAI allows up to 2048 inputs per request

// ─── Load API key ─────────────────────────────────────────────────────────────
function getApiKey() {
  // Try .dev.vars first
  const devVarsPath = path.join(__dirname, '..', '.dev.vars');
  if (fs.existsSync(devVarsPath)) {
    const content = fs.readFileSync(devVarsPath, 'utf-8');
    const match = content.match(/OPENAI_API_KEY\s*=\s*(.+)/);
    if (match) return match[1].trim();
  }
  // Try environment variable
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  throw new Error('OPENAI_API_KEY not found in .dev.vars or environment');
}

// ─── OpenAI Embedding ─────────────────────────────────────────────────────────
async function embedBatch(texts, apiKey) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.data.map(d => d.embedding);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = getApiKey();
  const chunks = JSON.parse(fs.readFileSync(CHUNKS_PATH, 'utf-8'));

  console.log(`📄 ${chunks.length} chunk betöltve`);

  // ── Step 1: Embed all chunks ──────────────────────────────────────────────
  console.log(`\n🔄 Embedding (${EMBEDDING_MODEL}, ${EMBEDDING_DIMENSIONS} dims)...`);

  const allEmbeddings = [];
  let totalTokens = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.text);

    process.stdout.write(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)}...`);
    const embeddings = await embedBatch(texts, apiKey);
    allEmbeddings.push(...embeddings);
    console.log(` ✓ (${embeddings.length} vectors)`);
  }

  console.log(`✓ ${allEmbeddings.length} embedding kész`);

  // ── Step 2: Write NDJSON for Vectorize bulk upload ────────────────────────
  const ndjsonPath = path.join(__dirname, '..', 'data', 'vectors.ndjson');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const ndjsonLines = chunks.map((chunk, i) => {
    return JSON.stringify({
      id: chunk.id,
      values: allEmbeddings[i],
      metadata: {
        section_h1: chunk.section_h1,
        section_h2: chunk.section_h2,
        section: chunk.section,
        text_preview: chunk.text.substring(0, 150),
      },
    });
  });

  fs.writeFileSync(ndjsonPath, ndjsonLines.join('\n'), 'utf-8');
  console.log(`\n✓ vectors.ndjson megírva (${ndjsonLines.length} vectors)`);

  // ── Step 3: Write KV bulk data ────────────────────────────────────────────
  // Each chunk stored as KV key: chunk:{id} → full chunk JSON
  const kvPath = path.join(dataDir, 'kv-chunks.json');
  const kvData = chunks.map(c => ({
    key: `chunk:${c.id}`,
    value: JSON.stringify({
      id: c.id,
      section_h1: c.section_h1,
      section_h2: c.section_h2,
      section: c.section,
      text: c.text,
    }),
  }));
  fs.writeFileSync(kvPath, JSON.stringify(kvData, null, 2), 'utf-8');
  console.log(`✓ kv-chunks.json megírva (${kvData.length} entries)`);

  // ── Step 4: Write BM25 index for KV ───────────────────────────────────────
  const bm25Path = path.join(dataDir, 'bm25-index.json');
  const df = {}; // document frequency: term → count of docs containing it
  const chunkTerms = {}; // per-chunk term frequencies
  const N = chunks.length;
  let totalDl = 0;

  for (const chunk of chunks) {
    const terms = tokenize(chunk.text);
    const tf = {};
    for (const t of terms) tf[t] = (tf[t] || 0) + 1;

    chunkTerms[chunk.id] = { tf, dl: terms.length };
    totalDl += terms.length;

    const seen = new Set(terms);
    for (const t of seen) df[t] = (df[t] || 0) + 1;
  }

  const bm25Index = {
    N,
    avgDl: totalDl / N,
    df,
    chunks: chunkTerms,
  };

  fs.writeFileSync(bm25Path, JSON.stringify(bm25Index), 'utf-8');
  console.log(`✓ bm25-index.json megírva (${Object.keys(df).length} unique terms)`);

  // ── Instructions ──────────────────────────────────────────────────────────
  console.log(`
═══════════════════════════════════════════════════════════════
  Következő lépések (futtasd ezeket manuálisan):

  1. Vectorize feltöltés:
     npx wrangler vectorize insert tisza-program-chunks --file data/vectors.ndjson

  2. KV feltöltés (chunks):
     npx wrangler kv:bulk put --namespace-id YOUR_KV_ID data/kv-chunks.json

  3. KV feltöltés (BM25 index):
     npx wrangler kv:key put --namespace-id YOUR_KV_ID "bm25:index" --path data/bm25-index.json
═══════════════════════════════════════════════════════════════
  `);
}

// ─── Tokenizer (Hungarian-aware) ──────────────────────────────────────────────
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\wáéíóöőúüű]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

main().catch(err => {
  console.error('❌ Hiba:', err.message);
  process.exit(1);
});
