/**
 * /api/debug-search — Debug endpoint to test search pipeline
 */

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const { query } = await request.json();

    // Embed
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: query,
        dimensions: 1536,
      }),
    });
    const embData = await res.json();
    const embedding = embData.data[0].embedding;

    // Vector search
    const vectorResults = await env.VECTORIZE.query(embedding, {
      topK: 10,
      returnMetadata: 'all',
    });

    // BM25
    const index = await env.KV.get('bm25:index', 'json');
    const bm25Info = index ? { N: index.N, avgDl: index.avgDl, termCount: Object.keys(index.df).length } : null;

    // Test KV chunk fetch
    const testChunk = await env.KV.get('chunk:chunk-0334', 'json');

    return Response.json({
      query,
      embeddingDim: embedding.length,
      embeddingFirst3: embedding.slice(0, 3),
      vectorResults: vectorResults.matches?.map(m => ({
        id: m.id,
        score: m.score,
        section: m.metadata?.section,
        preview: m.metadata?.text_preview?.substring(0, 80),
      })),
      bm25Info,
      testChunkExists: !!testChunk,
      testChunkSection: testChunk?.section,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return Response.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
