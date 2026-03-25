/**
 * /api/chat — RAG pipeline with Vectorize + BM25 hybrid search + SSE streaming
 *
 * Bindings required:
 *   - VECTORIZE: Cloudflare Vectorize index
 *   - KV: Cloudflare KV namespace
 *   - OPENAI_API_KEY: secret
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const EMBEDDING_MODEL = 'text-embedding-3-small';
const LLM_MODEL = 'gpt-4o-mini';
const VECTOR_TOP_K = 15;
const BM25_TOP_K = 15;
const FINAL_TOP_K = 8;
const MAX_HISTORY = 10;
const RATE_LIMIT = 30;           // requests per window
const RATE_WINDOW_MS = 3600000;  // 1 hour
const SESSION_TTL = 86400;       // 24 hours in seconds

// ─── Blocked patterns (other parties, campaigning, profanity, prompt injection) ───
const BLOCKED_PATTERNS = [
  // Other parties / politicians
  /fidesz|orbán|gyurcsány|dk\b|mszp|lmp|momentum/i,
  // Campaigning / vote manipulation
  /szavazz|válassz|voksolj|ne szavazz/i,
  // Profanity / insults
  /hülye|idióta|barom|kurva|szar/i,
  /kurv[aá]/i,
  /fasz/i,
  /szar(?!vas)/i,
  /geci/i,
  /buzi/i,
  // Hate speech
  /cigány.*(?:dög|szar|pusztul)/i,
  /(?:halj|dögölj|pusztulj)\s*(?:meg|el)/i,
  /zsidó.*(?:dög|szar|pusztul)/i,
  /(?:ölj|öld)\s*(?:meg|ki)/i,
  /nácik?(?:at)?\s/i,
  // Prompt injection
  /ignore.*(?:previous|above|system)/i,
  /felejtsd?\s*el/i,
  /változtasd?\s*meg.*(?:instrukció|szabály|prompt)/i,
  /te\s*most\s*már/i,
  /act\s*as/i,
  /you\s*are\s*now/i,
  /system\s*prompt/i,
  /DAN\b/i,
  /jailbreak/i,
];

// ─── CORS headers ─────────────────────────────────────────────────────────────
function corsHeaders(contentType = 'application/json') {
  return {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ─── OPTIONS handler ──────────────────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ─── POST handler ─────────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    // ── Parse request ─────────────────────────────────────────────────────
    const body = await request.json();
    const query = body.query;
    const sessionId = body.sessionId || crypto.randomUUID();

    if (!query || typeof query !== 'string' || query.length > 2000) {
      return jsonResponse({ error: 'Érvénytelen kérdés.' }, 400);
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: 'API kulcs nincs beállítva.' }, 500);
    }

    // ── Input filter ──────────────────────────────────────────────────────
    if (isBlocked(query)) {
      return Response.json({
        answer: 'Ez az eszköz kizárólag a Tisza Párt programjáról válaszol. Más pártokról, politikusokról vagy kampánytémákról nem tudok nyilatkozni.',
      }, { headers: corsHeaders() });
    }

    // ── Rate limit (IP-based via KV) ──────────────────────────────────────
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitOk = await checkRateLimit(env.KV, ip);
    if (!rateLimitOk) {
      return jsonResponse({
        error: 'rate_limit',
        message: 'Túl sok kérdés. Kérlek próbáld újra egy kicsit később!',
      }, 429);
    }

    // ── Load session history ──────────────────────────────────────────────
    let history = [];
    try {
      const stored = await env.KV.get(`session:${sessionId}`, 'json');
      if (stored && Array.isArray(stored)) history = stored.slice(-MAX_HISTORY);
    } catch (_) { /* no session yet */ }

    // ── Query rewriting for follow-ups ────────────────────────────────────
    let searchQuery = query;
    if (history.length >= 2) {
      searchQuery = await rewriteQuery(env.OPENAI_API_KEY, query, history);
    }

    // ── Embed query ───────────────────────────────────────────────────────
    const queryEmbedding = await embedText(env.OPENAI_API_KEY, searchQuery);
    console.log('[DEBUG] searchQuery:', searchQuery);
    console.log('[DEBUG] embedding dim:', queryEmbedding.length, 'first3:', queryEmbedding.slice(0,3));

    // ── Vector search ─────────────────────────────────────────────────────
    const vectorResults = await env.VECTORIZE.query(queryEmbedding, {
      topK: VECTOR_TOP_K,
      returnMetadata: 'all',
    });
    console.log('[DEBUG] vectorResults count:', vectorResults.matches?.length);
    console.log('[DEBUG] vector top5:', vectorResults.matches?.slice(0,5).map(m => `${m.id}(${m.score?.toFixed(3)})`));

    // ── BM25 search ───────────────────────────────────────────────────────
    const bm25Results = await bm25Search(env.KV, searchQuery);
    console.log('[DEBUG] bm25Results count:', bm25Results.length);
    console.log('[DEBUG] bm25 top5:', bm25Results.slice(0,5).map(r => `${r.id}(${r.score?.toFixed(3)})`));

    // ── Reciprocal Rank Fusion ────────────────────────────────────────────
    const mergedIds = reciprocalRankFusion(
      vectorResults.matches.map(m => m.id),
      bm25Results.map(r => r.id),
      FINAL_TOP_K
    );
    console.log('[DEBUG] mergedIds:', mergedIds);

    // ── Fetch full chunk texts from KV ────────────────────────────────────
    const chunks = await Promise.all(
      mergedIds.map(async (id) => {
        const data = await env.KV.get(`chunk:${id}`, 'json');
        return data;
      })
    );
    const validChunks = chunks.filter(Boolean);

    // ── Build system prompt ───────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(validChunks);

    // ── Stream response via SSE ───────────────────────────────────────────
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Send initial events, then stream LLM response
    const streamPromise = (async () => {
      try {
        // Send session ID
        await sseWrite(writer, encoder, 'session', { sessionId });

        // Send sources
        await sseWrite(writer, encoder, 'sources', {
          chunks: validChunks.map(c => ({
            id: c.id,
            section: c.section,
          })),
        });

        // Stream LLM
        const fullAnswer = await streamLLM(
          env.OPENAI_API_KEY,
          systemPrompt,
          history,
          query,
          writer,
          encoder
        );

        // Parse chunk refs from answer
        const chunkRefs = [
          ...new Set(
            [...fullAnswer.matchAll(/\[chunk-(\d{4})\]/g)].map(m => `chunk-${m[1]}`)
          ),
        ];

        // Send done event
        await sseWrite(writer, encoder, 'done', { chunkRefs });

        // Save conversation to KV
        const newHistory = [
          ...history,
          { role: 'user', content: query },
          { role: 'assistant', content: fullAnswer },
        ].slice(-MAX_HISTORY);

        await env.KV.put(`session:${sessionId}`, JSON.stringify(newHistory), {
          expirationTtl: SESSION_TTL,
        });

      } catch (err) {
        console.error('Stream error:', err);
        await sseWrite(writer, encoder, 'error', { message: 'Hiba történt a válasz generálásakor.' });
      } finally {
        await writer.close();
      }
    })();

    // Don't await — let it stream
    context.waitUntil(streamPromise);

    return new Response(readable, {
      headers: corsHeaders('text/event-stream'),
    });

  } catch (err) {
    console.error('Chat error:', err);
    return jsonResponse({ error: 'Szerverhiba történt.' }, 500);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders() });
}

function isBlocked(text) {
  return BLOCKED_PATTERNS.some(p => p.test(text));
}

async function sseWrite(writer, encoder, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  await writer.write(encoder.encode(msg));
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

async function checkRateLimit(kv, ip) {
  const key = `ratelimit:${ip}`;
  const stored = await kv.get(key, 'json');
  const now = Date.now();
  let timestamps = [];

  if (stored && Array.isArray(stored)) {
    timestamps = stored.filter(t => now - t < RATE_WINDOW_MS);
  }

  if (timestamps.length >= RATE_LIMIT) return false;

  timestamps.push(now);
  await kv.put(key, JSON.stringify(timestamps), {
    expirationTtl: Math.ceil(RATE_WINDOW_MS / 1000),
  });

  return true;
}

// ─── Embedding ────────────────────────────────────────────────────────────────

async function embedText(apiKey, text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: 1536,
    }),
  });

  if (!res.ok) throw new Error(`Embedding error: ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

// ─── Query rewriting ──────────────────────────────────────────────────────────

async function rewriteQuery(apiKey, query, history) {
  const lastExchanges = history.slice(-4).map(m =>
    `${m.role === 'user' ? 'Felhasználó' : 'Asszisztens'}: ${m.content.substring(0, 200)}`
  ).join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 100,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'Írd át a felhasználó kérdését önálló, kereshető kérdéssé a beszélgetés kontextusa alapján. Csak a kérdést írd, semmi mást.'
        },
        {
          role: 'user',
          content: `Korábbi beszélgetés:\n${lastExchanges}\n\nÚj kérdés: ${query}`
        },
      ],
    }),
  });

  if (!res.ok) return query; // fallback to original
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || query;
}

// ─── BM25 Search ──────────────────────────────────────────────────────────────

async function bm25Search(kv, query) {
  const index = await kv.get('bm25:index', 'json');
  if (!index) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const { N, avgDl, df, chunks: chunkTerms } = index;
  const k1 = 1.5;
  const b = 0.75;
  const scores = {};

  for (const [chunkId, chunkData] of Object.entries(chunkTerms)) {
    let score = 0;
    const { tf, dl } = chunkData;

    for (const term of queryTerms) {
      const termTf = tf[term] || 0;
      if (termTf === 0) continue;

      const termDf = df[term] || 0;
      const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);
      const tfNorm = (termTf * (k1 + 1)) / (termTf + k1 * (1 - b + b * (dl / avgDl)));
      score += idf * tfNorm;
    }

    if (score > 0) scores[chunkId] = score;
  }

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, BM25_TOP_K)
    .map(([id, score]) => ({ id, score }));
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\wáéíóöőúüű]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

// ─── Reciprocal Rank Fusion ───────────────────────────────────────────────────

function reciprocalRankFusion(vectorIds, bm25Ids, topK) {
  const K = 60; // RRF constant
  const scores = {};

  vectorIds.forEach((id, rank) => {
    scores[id] = (scores[id] || 0) + 1 / (K + rank + 1);
  });

  bm25Ids.forEach((id, rank) => {
    scores[id] = (scores[id] || 0) + 1 / (K + rank + 1);
  });

  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id]) => id);
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(chunks) {
  const chunksText = chunks.map(c =>
    `[${c.id}] (${c.section})\n${c.text}`
  ).join('\n\n---\n\n');

  return `Te egy segítőkész asszisztens vagy, aki KIZÁRÓLAG a Tisza Párt 2026-os választási programdokumentuma alapján válaszol.

Szabályok:
- Csak a megadott dokumentum-részletek alapján válaszolj
- Ha a kérdés nem szerepel a programban: 'Erre a kérdésre nem találok választ a programdokumentumban.'
- Soha ne hasonlítsd össze más pártokkal, ne értékelj, ne adj politikai véleményt
- Soha ne ajánlj jelöltre szavazást vagy ne szavazást
- Ha sértő vagy irreleváns a kérdés, udvariasan utasítsd el
- Magyarul válaszolj, tömören és pontosan

VÁLASZ FORMÁTUM:
- Idézz PONTOS szöveget a megadott részletekből, idézőjelben: „..."
- Minden idézet után zárójelben jelöld a forrást: [chunk-XXXX]
- Csak annyi saját szöveget adj hozzá, amennyi a kérdés megválaszolásához feltétlenül szükséges (max 1-2 rövid mondat kötőszöveg)
- Ha több releváns rész van, idézd mindegyiket külön bekezdésben
- Számokat, vállalásokat, határidőket pontosan idézz, ne kerekíts

PROGRAMRÉSZLETEK:
${chunksText}`;
}

// ─── Streaming LLM ───────────────────────────────────────────────────────────

async function streamLLM(apiKey, systemPrompt, history, query, writer, encoder) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: String(m.content).slice(0, 2000),
    })),
    { role: 'user', content: query },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 1000,
      temperature: 0.15,
      stream: true,
      messages,
    }),
  });

  if (res.status === 429) {
    await sseWrite(writer, encoder, 'error', {
      message: 'A napi keret átmenetileg elfogyott. Kérlek próbáld újra néhány perc múlva, vagy olvasd el a programot közvetlenül: mostvagysoha.hu',
    });
    await writer.close();
    return '';
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM error ${res.status}: ${errText}`);
  }

  let fullAnswer = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullAnswer += delta;
          await sseWrite(writer, encoder, 'delta', { text: delta });
        }
      } catch (_) { /* skip malformed */ }
    }
  }

  return fullAnswer;
}
