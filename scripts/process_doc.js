const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.join(__dirname, 'source.md');
const CHUNKS_PATH = path.join(__dirname, '..', 'data', 'chunks.json');
const DOCUMENT_PATH = path.join(__dirname, '..', 'data', 'document.html');
const PUBLIC_CHUNKS_PATH = path.join(__dirname, '..', 'public', 'data', 'chunks.json');
const PUBLIC_DOCUMENT_PATH = path.join(__dirname, '..', 'public', 'data', 'document.html');

// Ensure output directories exist
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Hungarian stop words to exclude from keywords
const STOP_WORDS = new Set([
  'a', 'az', 'és', 'is', 'egy', 'ez', 'azt', 'hogy', 'nem', 'meg',
  'de', 'van', 'volt', 'lesz', 'már', 'még', 'mint', 'csak', 'majd',
  'el', 'fel', 'ki', 'be', 'le', 'át', 'össze', 'ide', 'oda',
  'aki', 'ami', 'amely', 'ahol', 'amikor', 'mivel', 'mert', 'ha',
  'vagy', 'sem', 'ill', 'illetve', 'stb', 'pl', 'pl.', 'ún',
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

function extractKeywords(text, maxKeywords = 8) {
  const words = text
    .toLowerCase()
    .replace(/[^\wáéíóöőúüű-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

function processDocument() {
  const source = fs.readFileSync(SOURCE_PATH, 'utf-8');
  const lines = source.split('\n');

  const chunks = [];
  const htmlParts = [];
  const tocEntries = [];

  let currentSection = '';
  let currentH1 = '';
  let currentH1Num = '';
  let currentH2Num = '';
  let chunkCounter = 0;
  let buffer = '';
  let bufferType = 'p'; // 'p', 'bullet', 'h1', 'h2'
  let bulletBuffer = [];

  function flushBullets() {
    if (bulletBuffer.length === 0) return;
    for (const bullet of bulletBuffer) {
      chunkCounter++;
      const id = `chunk-${String(chunkCounter).padStart(3, '0')}`;
      const text = bullet.trim();
      chunks.push({
        id,
        section: currentSection,
        text,
        keywords: extractKeywords(text),
      });
      htmlParts.push(`      <li class="bullet-item" id="${id}">${escapeHtml(text)}</li>`);
    }
    bulletBuffer = [];
  }

  function flushParagraph() {
    if (!buffer.trim()) return;
    chunkCounter++;
    const id = `chunk-${String(chunkCounter).padStart(3, '0')}`;
    const text = buffer.trim();
    chunks.push({
      id,
      section: currentSection,
      text,
      keywords: extractKeywords(text),
    });
    htmlParts.push(`    <p id="${id}">${escapeHtml(text)}</p>`);
    buffer = '';
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Start HTML
  htmlParts.push(`<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tisza Párt – 2026-os Választási Program</title>
  <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'EB Garamond', Georgia, serif;
      font-size: 15px;
      line-height: 1.8;
      color: #1A1A18;
      background: #FAFAF8;
      max-width: 680px;
      margin: 0 auto;
      padding: 40px 48px;
    }
    h1 {
      font-size: 22px;
      font-variant: small-caps;
      letter-spacing: 1px;
      border-left: 4px solid #006B3C;
      padding-left: 12px;
      margin: 32px 0 16px;
      text-transform: uppercase;
      line-height: 1.4;
      color: #1A3A5C;
    }
    h2 {
      font-size: 17px;
      font-weight: bold;
      margin: 24px 0 10px;
      color: #1A3A5C;
      line-height: 1.5;
    }
    p {
      margin: 8px 0;
      text-align: justify;
    }
    ul {
      list-style: none;
      margin: 8px 0;
      padding-left: 8px;
    }
    .bullet-item {
      margin: 4px 0;
      padding-left: 20px;
      position: relative;
    }
    .bullet-item::before {
      content: '\\00BB ';
      color: #006B3C;
      font-weight: bold;
      position: absolute;
      left: 0;
    }
    .page-num {
      font-family: 'DM Sans', system-ui, sans-serif;
      font-size: 10px;
      color: #999;
      display: block;
      margin-bottom: 4px;
    }
    .chunk-highlight {
      background: #fff3b0;
      border-radius: 4px;
      transition: background 2s ease;
    }
    .chunk-highlight.fade {
      background: transparent;
    }
    .doc-title {
      text-align: center;
      font-size: 28px;
      font-variant: small-caps;
      letter-spacing: 2px;
      margin: 20px 0 40px;
      border-bottom: 3px solid #006B3C;
      padding-bottom: 16px;
      color: #1A3A5C;
    }
  </style>
</head>
<body>
  <div class="doc-title">Tisza Párt – 2026-os Választási Program</div>
`);

  let inBulletList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      if (inBulletList) {
        flushBullets();
        htmlParts.push('    </ul>');
        inBulletList = false;
      }
      flushParagraph();
      continue;
    }

    // Page number pattern: number at start followed by spaces and uppercase title
    const pageMatch = trimmed.match(/^(\d+)\s{2,}([A-ZÁÉÍÓÖŐÚÜŰ\s]+)$/);
    if (pageMatch) {
      if (inBulletList) {
        flushBullets();
        htmlParts.push('    </ul>');
        inBulletList = false;
      }
      flushParagraph();
      htmlParts.push(`    <span class="page-num">${pageMatch[1]}. oldal</span>`);
      continue;
    }

    // H1: # TITLE
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      if (inBulletList) {
        flushBullets();
        htmlParts.push('    </ul>');
        inBulletList = false;
      }
      flushParagraph();
      const title = trimmed.replace(/^# /, '');
      // Extract section number
      const numMatch = title.match(/^(\d+)\./);
      if (numMatch) {
        currentH1Num = numMatch[1];
      } else {
        currentH1Num = '';
      }
      currentH1 = title;
      currentSection = title;
      const tocId = currentH1Num ? `toc-${currentH1Num}` : `toc-h1-${i}`;
      tocEntries.push({ level: 1, title, id: tocId, num: currentH1Num });
      htmlParts.push(`    <h1 id="${tocId}">${escapeHtml(title)}</h1>`);
      continue;
    }

    // H2: ## Subtitle
    if (trimmed.startsWith('## ')) {
      if (inBulletList) {
        flushBullets();
        htmlParts.push('    </ul>');
        inBulletList = false;
      }
      flushParagraph();
      const title = trimmed.replace(/^## /, '');
      const numMatch = title.match(/^(\d+\.\d+)/);
      if (numMatch) {
        currentH2Num = numMatch[1];
      }
      currentSection = title;
      const tocId = currentH2Num ? `toc-${currentH2Num.replace('.', '-')}` : `toc-h2-${i}`;
      tocEntries.push({ level: 2, title, id: tocId, parentNum: currentH1Num });
      htmlParts.push(`    <h2 id="${tocId}">${escapeHtml(title)}</h2>`);
      continue;
    }

    // Bullet: » item
    if (trimmed.startsWith('»') || trimmed.startsWith('>>')) {
      flushParagraph();
      if (!inBulletList) {
        htmlParts.push('    <ul>');
        inBulletList = true;
      }
      const bulletText = trimmed.replace(/^[»>]+\s*/, '');
      bulletBuffer.push(bulletText);
      continue;
    }

    // Regular paragraph text
    if (inBulletList) {
      flushBullets();
      htmlParts.push('    </ul>');
      inBulletList = false;
    }

    // Accumulate paragraph - merge short consecutive lines
    if (buffer) {
      buffer += ' ' + trimmed;
    } else {
      buffer = trimmed;
    }

    // If buffer is large enough or next line is empty/heading, flush
    const nextLine = lines[i + 1]?.trim() || '';
    if (
      buffer.length > 600 ||
      !nextLine ||
      nextLine.startsWith('#') ||
      nextLine.startsWith('»') ||
      nextLine.startsWith('>>')
    ) {
      flushParagraph();
    }
  }

  // Flush remaining
  if (inBulletList) {
    flushBullets();
    htmlParts.push('    </ul>');
  }
  flushParagraph();

  // Close HTML
  htmlParts.push(`
</body>
</html>`);

  // Build TOC HTML for the main app
  const tocHtml = buildTocHtml(tocEntries);

  // Write outputs
  ensureDir(CHUNKS_PATH);
  ensureDir(DOCUMENT_PATH);
  ensureDir(PUBLIC_CHUNKS_PATH);
  ensureDir(PUBLIC_DOCUMENT_PATH);

  const chunksJson = JSON.stringify(chunks, null, 2);
  const documentHtml = htmlParts.join('\n');

  // Write to data/
  fs.writeFileSync(CHUNKS_PATH, chunksJson, 'utf-8');
  fs.writeFileSync(DOCUMENT_PATH, documentHtml, 'utf-8');

  // Also write to public/data/ for the frontend
  fs.writeFileSync(PUBLIC_CHUNKS_PATH, chunksJson, 'utf-8');
  fs.writeFileSync(PUBLIC_DOCUMENT_PATH, documentHtml, 'utf-8');

  // Write TOC data as JSON
  const tocPath = path.join(__dirname, '..', 'public', 'data', 'toc.json');
  fs.writeFileSync(tocPath, JSON.stringify(tocEntries, null, 2), 'utf-8');

  console.log(`✓ Feldolgozás kész!`);
  console.log(`  - ${chunks.length} chunk generálva → data/chunks.json`);
  console.log(`  - Dokumentum HTML generálva → data/document.html`);
  console.log(`  - Publikus másolatok → public/data/`);
  console.log(`  - TOC → public/data/toc.json`);
}

function buildTocHtml(entries) {
  let html = '';
  for (const entry of entries) {
    if (entry.level === 1) {
      html += `<div class="toc-h1"><a href="#${entry.id}">${entry.title}</a></div>\n`;
    } else {
      html += `<div class="toc-h2"><a href="#${entry.id}">${entry.title}</a></div>\n`;
    }
  }
  return html;
}

// Run
processDocument();
