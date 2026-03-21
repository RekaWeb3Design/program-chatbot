/**
 * process_chunks.js — Szekció-tudatos chunking pipeline
 *
 * Generates:
 *   public/data/chunks.json          — full chunks (id, section_h1, section_h2, text, keywords)
 *   public/data/chunks-meta.json     — lightweight (id, section) for client-side display
 *   public/data/document-content.json — HTML body for document viewer
 *   public/data/toc.json             — table of contents
 */

const fs = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────
const SOURCE_PATH = path.join(__dirname, 'source.md');
const OUT_DIR = path.join(__dirname, '..', 'public', 'data');

// ─── Config ───────────────────────────────────────────────────────────────────
const CHUNK_TARGET = 1000;   // target chars per chunk
const CHUNK_MIN = 80;        // discard chunks shorter than this
const CHUNK_MAX = 1400;      // hard max before forced split
const OVERLAP_CHARS = 150;   // overlap between consecutive chunks in same section

// ─── Hungarian stop words (for keyword extraction) ────────────────────────────
const STOP_WORDS = new Set([
  'a', 'az', 'és', 'is', 'egy', 'ez', 'azt', 'hogy', 'nem', 'meg',
  'de', 'van', 'volt', 'lesz', 'már', 'még', 'mint', 'csak', 'majd',
  'el', 'fel', 'ki', 'be', 'le', 'át', 'össze', 'ide', 'oda',
  'aki', 'ami', 'amely', 'ahol', 'amikor', 'mivel', 'mert', 'ha',
  'vagy', 'sem', 'ill', 'illetve', 'stb', 'pl', 'ún',
  'kell', 'lehet', 'fog', 'való', 'lenne', 'legyen',
  'minden', 'több', 'nagy', 'új', 'két', 'sok', 'első',
  'között', 'szerint', 'után', 'előtt', 'alatt', 'felett', 'mellett',
  'által', 'alapján', 'során', 'esetén', 'számára', 'révén',
  'így', 'úgy', 'itt', 'ott', 'most', 'akkor', 'pedig', 'viszont',
  'ezt', 'abban', 'ezen', 'annak', 'ennek', 'arra', 'erre',
  'vele', 'benne', 'róla', 'nekik', 'őket', 'ezzel', 'azzal',
  'melyek', 'amelyek', 'amelyet', 'amelynek', 'akik',
  'forint', 'százalék', 'éve', 'évben', 'rendszer', 'terület',
  'szükséges', 'biztosítása', 'lehetőség', 'fejlesztése', 'magyar',
  'magyarország', 'magyarországi', 'nemzeti', 'kormány', 'állam', 'állami',
  'program', 'célja',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractKeywords(text, max = 8) {
  const words = text
    .toLowerCase()
    .replace(/[^\wáéíóöőúüű-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([word]) => word);
}

/**
 * Split text into chunks at sentence boundaries, respecting target size.
 * Returns array of strings.
 */
function splitIntoChunks(text) {
  if (text.length <= CHUNK_MAX) return [text];

  // Split on sentence boundaries (Hungarian: . ! ? followed by space + uppercase, or newline)
  const sentences = text.match(/[^.!?]*[.!?]+[\s]*/g) || [text];

  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > CHUNK_MAX && current.length >= CHUNK_MIN) {
      chunks.push(current.trim());
      // Overlap: take last OVERLAP_CHARS from current
      const overlap = current.slice(-OVERLAP_CHARS).trim();
      current = overlap + ' ' + sentence;
    } else {
      current += sentence;
    }

    // If we're at a nice size and the next sentence would push us over, flush
    if (current.length >= CHUNK_TARGET) {
      chunks.push(current.trim());
      const overlap = current.slice(-OVERLAP_CHARS).trim();
      current = overlap + ' ';
    }
  }

  if (current.trim().length >= CHUNK_MIN) {
    chunks.push(current.trim());
  } else if (current.trim().length > 0 && chunks.length > 0) {
    // Append tiny remainder to last chunk
    chunks[chunks.length - 1] += ' ' + current.trim();
  }

  return chunks;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function processDocument() {
  const source = fs.readFileSync(SOURCE_PATH, 'utf-8');
  const lines = source.split('\n');

  // ── Pass 1: Parse document into sections ──────────────────────────────────
  // Each section = { h1, h2, paragraphs: string[], bullets: string[] }

  const sections = [];
  const tocEntries = [];
  let currentH1 = '';
  let currentH1Num = '';
  let currentH2 = '';
  let currentH2Num = '';
  let currentParagraphs = [];
  let currentBullets = [];
  let buffer = '';

  function flushBuffer() {
    if (buffer.trim()) {
      currentParagraphs.push(buffer.trim());
      buffer = '';
    }
  }

  function flushSection() {
    flushBuffer();

    // If there are accumulated bullets, merge them as one text block
    if (currentBullets.length > 0) {
      // Group bullets into paragraph-sized blocks
      let bulletBlock = '';
      for (const b of currentBullets) {
        if (bulletBlock.length + b.length > CHUNK_TARGET && bulletBlock.length >= CHUNK_MIN) {
          currentParagraphs.push(bulletBlock.trim());
          bulletBlock = '';
        }
        bulletBlock += (bulletBlock ? ' ' : '') + '» ' + b;
      }
      if (bulletBlock.trim()) {
        currentParagraphs.push(bulletBlock.trim());
      }
      currentBullets = [];
    }

    if (currentParagraphs.length > 0) {
      sections.push({
        h1: currentH1,
        h2: currentH2,
        content: currentParagraphs.join('\n\n'),
      });
      currentParagraphs = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushBuffer();
      // If we had bullets accumulating and hit empty line, flush them
      if (currentBullets.length > 0) {
        let bulletBlock = '';
        for (const b of currentBullets) {
          if (bulletBlock.length + b.length > CHUNK_TARGET && bulletBlock.length >= CHUNK_MIN) {
            currentParagraphs.push(bulletBlock.trim());
            bulletBlock = '';
          }
          bulletBlock += (bulletBlock ? ' ' : '') + '» ' + b;
        }
        if (bulletBlock.trim()) currentParagraphs.push(bulletBlock.trim());
        currentBullets = [];
      }
      continue;
    }

    // Page number pattern — skip
    if (/^\d+\s{2,}[A-ZÁÉÍÓÖŐÚÜŰ\s]+$/.test(trimmed)) continue;

    // H1
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      flushSection();
      const title = trimmed.replace(/^# /, '');
      const numMatch = title.match(/^(\d+)\./);
      currentH1Num = numMatch ? numMatch[1] : '';
      currentH1 = title;
      currentH2 = '';
      currentH2Num = '';

      const displayTitle = title === 'Magyarország nem működik' ? 'Magyarország helyzete' : title;
      const tocId = currentH1Num ? `toc-${currentH1Num}` : `toc-h1-${i}`;
      tocEntries.push({ level: 1, title: displayTitle, id: tocId, num: currentH1Num });
      continue;
    }

    // H2
    if (trimmed.startsWith('## ')) {
      flushSection();
      const title = trimmed.replace(/^## /, '');
      const numMatch = title.match(/^(\d+\.\d+)/);
      currentH2Num = numMatch ? numMatch[1] : '';
      currentH2 = title;

      const tocId = currentH2Num ? `toc-${currentH2Num.replace('.', '-')}` : `toc-h2-${i}`;
      tocEntries.push({ level: 2, title, id: tocId, parentNum: currentH1Num });
      continue;
    }

    // Bullet
    if (trimmed.startsWith('»') || trimmed.startsWith('>>')) {
      flushBuffer();
      const bulletText = trimmed.replace(/^[»>]+\s*/, '');
      currentBullets.push(bulletText);
      continue;
    }

    // Regular text — accumulate into buffer
    buffer += (buffer ? ' ' : '') + trimmed;
  }

  flushSection(); // flush last section

  // ── Pass 2: Create chunks from sections ───────────────────────────────────

  const chunks = [];
  let chunkCounter = 0;

  for (const section of sections) {
    const sectionName = section.h2 || section.h1;
    const textBlocks = section.content.split('\n\n').filter(t => t.trim());

    for (const block of textBlocks) {
      const subChunks = splitIntoChunks(block);

      for (const text of subChunks) {
        if (text.length < CHUNK_MIN) continue;

        chunkCounter++;
        const id = `chunk-${String(chunkCounter).padStart(4, '0')}`;
        chunks.push({
          id,
          section_h1: section.h1,
          section_h2: section.h2,
          section: sectionName,
          text,
          keywords: extractKeywords(text),
        });
      }
    }
  }

  // ── Pass 3: Generate HTML document ────────────────────────────────────────

  const htmlParts = [];
  htmlParts.push(`<div class="doc-title">Tisza Párt – 2026-os Választási Program</div>`);

  // Re-parse source for HTML generation (preserves original structure for viewer)
  let inBulletList = false;
  let htmlCurrentH1Num = '';
  let htmlCurrentH2Num = '';
  let htmlBuffer = '';
  let htmlChunkCounter = 0;

  function flushHtmlParagraph() {
    if (!htmlBuffer.trim()) return;
    htmlChunkCounter++;
    const id = `chunk-${String(htmlChunkCounter).padStart(4, '0')}`;
    htmlParts.push(`    <p id="${id}">${escapeHtml(htmlBuffer.trim())}</p>`);
    htmlBuffer = '';
  }

  function flushHtmlBullets(bullets) {
    for (const bullet of bullets) {
      htmlChunkCounter++;
      const id = `chunk-${String(htmlChunkCounter).padStart(4, '0')}`;
      htmlParts.push(`      <li class="bullet-item" id="${id}">${escapeHtml(bullet)}</li>`);
    }
  }

  // We need the HTML chunk IDs to match our chunk IDs.
  // Since the HTML is for viewing and chunks are for RAG, they can be independent.
  // The HTML will use simple sequential IDs matching the document order.
  // The chunk-ref scrolling maps chunk IDs to document element IDs.

  // Simpler approach: generate HTML with section IDs only (for TOC navigation),
  // and mark each paragraph/bullet with a data attribute for chunk matching.

  // Reset for HTML generation
  htmlParts.length = 0;
  htmlParts.push(`<div class="doc-title">Tisza Párt – 2026-os Választási Program</div>`);

  let htmlBulletBuffer = [];
  inBulletList = false;
  htmlCurrentH1Num = '';
  htmlCurrentH2Num = '';
  htmlBuffer = '';
  let paraCounter = 0;

  function flushHtmlPara() {
    if (!htmlBuffer.trim()) return;
    paraCounter++;
    htmlParts.push(`    <p id="para-${paraCounter}">${escapeHtml(htmlBuffer.trim())}</p>`);
    htmlBuffer = '';
  }

  function flushHtmlBulletList() {
    if (htmlBulletBuffer.length === 0) return;
    for (const b of htmlBulletBuffer) {
      paraCounter++;
      htmlParts.push(`      <li class="bullet-item" id="para-${paraCounter}">${escapeHtml(b)}</li>`);
    }
    htmlBulletBuffer = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      if (inBulletList) {
        flushHtmlBulletList();
        htmlParts.push('    </ul>');
        inBulletList = false;
      }
      flushHtmlPara();
      continue;
    }

    // Page number
    const pageMatch = trimmed.match(/^(\d+)\s{2,}([A-ZÁÉÍÓÖŐÚÜŰ\s]+)$/);
    if (pageMatch) {
      if (inBulletList) { flushHtmlBulletList(); htmlParts.push('    </ul>'); inBulletList = false; }
      flushHtmlPara();
      htmlParts.push(`    <span class="page-num">${pageMatch[1]}. oldal</span>`);
      continue;
    }

    // H1
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      if (inBulletList) { flushHtmlBulletList(); htmlParts.push('    </ul>'); inBulletList = false; }
      flushHtmlPara();
      const title = trimmed.replace(/^# /, '');
      const numMatch = title.match(/^(\d+)\./);
      htmlCurrentH1Num = numMatch ? numMatch[1] : '';
      const displayTitle = title === 'Magyarország nem működik' ? 'Magyarország helyzete' : title;
      const tocId = htmlCurrentH1Num ? `toc-${htmlCurrentH1Num}` : `toc-h1-${i}`;
      htmlParts.push(`    <h1 id="${tocId}">${escapeHtml(displayTitle)}</h1>`);
      continue;
    }

    // H2
    if (trimmed.startsWith('## ')) {
      if (inBulletList) { flushHtmlBulletList(); htmlParts.push('    </ul>'); inBulletList = false; }
      flushHtmlPara();
      const title = trimmed.replace(/^## /, '');
      const numMatch = title.match(/^(\d+\.\d+)/);
      htmlCurrentH2Num = numMatch ? numMatch[1] : '';
      const tocId = htmlCurrentH2Num ? `toc-${htmlCurrentH2Num.replace('.', '-')}` : `toc-h2-${i}`;
      htmlParts.push(`    <h2 id="${tocId}">${escapeHtml(title)}</h2>`);
      continue;
    }

    // Bullet
    if (trimmed.startsWith('»') || trimmed.startsWith('>>')) {
      flushHtmlPara();
      if (!inBulletList) { htmlParts.push('    <ul>'); inBulletList = true; }
      htmlBulletBuffer.push(trimmed.replace(/^[»>]+\s*/, ''));
      continue;
    }

    // Regular text
    if (inBulletList) { flushHtmlBulletList(); htmlParts.push('    </ul>'); inBulletList = false; }
    htmlBuffer += (htmlBuffer ? ' ' : '') + trimmed;

    const nextLine = lines[i + 1]?.trim() || '';
    if (htmlBuffer.length > 600 || !nextLine || nextLine.startsWith('#') || nextLine.startsWith('»') || nextLine.startsWith('>>')) {
      flushHtmlPara();
    }
  }

  if (inBulletList) { flushHtmlBulletList(); htmlParts.push('    </ul>'); }
  flushHtmlPara();

  // ── Write outputs ─────────────────────────────────────────────────────────

  ensureDir(OUT_DIR);

  // 1. Full chunks (for embedding pipeline + KV storage)
  fs.writeFileSync(
    path.join(OUT_DIR, 'chunks.json'),
    JSON.stringify(chunks, null, 2),
    'utf-8'
  );

  // 2. Lightweight chunks-meta (for client — only id + section)
  const meta = chunks.map(c => ({ id: c.id, section: c.section }));
  fs.writeFileSync(
    path.join(OUT_DIR, 'chunks-meta.json'),
    JSON.stringify(meta),
    'utf-8'
  );

  // 3. Document HTML body (for document viewer panel)
  const documentHtml = htmlParts.join('\n');
  fs.writeFileSync(
    path.join(OUT_DIR, 'document-content.json'),
    JSON.stringify({ html: documentHtml }),
    'utf-8'
  );

  // 4. TOC
  fs.writeFileSync(
    path.join(OUT_DIR, 'toc.json'),
    JSON.stringify(tocEntries, null, 2),
    'utf-8'
  );

  // ── Stats ─────────────────────────────────────────────────────────────────
  const lengths = chunks.map(c => c.text.length);
  const avg = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  const min = Math.min(...lengths);
  const max = Math.max(...lengths);

  console.log(`✓ Chunking kész!`);
  console.log(`  - ${chunks.length} chunk generálva`);
  console.log(`  - Átlag méret: ${avg} karakter (min: ${min}, max: ${max})`);
  console.log(`  - ${tocEntries.length} TOC bejegyzés`);
  console.log(`  - Fájlok: chunks.json, chunks-meta.json, document-content.json, toc.json`);
}

processDocument();
