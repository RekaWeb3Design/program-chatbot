// ========== STATE ==========
let CHUNKS = [];
let TOC = [];
let conversationHistory = [];
let quickQuestionsVisible = true;
let lastActiveChunkId = null;
let lastSentChunks = [];

// ========== INIT ==========
async function initApp() {
  if (typeof window !== 'undefined' && window.__TISZA_CHATBOT_INIT__) return;
  if (typeof window !== 'undefined') window.__TISZA_CHATBOT_INIT__ = true;

  await loadChunks();
  await loadDocument();
  initIntersectionObserver();
  await loadToc();
  initDivider();
  initInput();
  initMobileTabs();
  initQuickQuestions();
  updateRateLimitDisplay();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void initApp(), { once: true });
} else {
  void initApp();
}

// ========== DATA LOADING ==========
async function loadChunks() {
  try {
    const res = await fetch('/data/chunks.json');
    CHUNKS = await res.json();
    console.log(`Loaded ${CHUNKS.length} chunks`);
  } catch (e) {
    console.warn('chunks.json not found - run npm run process first');
    CHUNKS = [];
  }
}

async function loadDocument() {
  const el = document.getElementById('docContent');
  if (!el) return;
  try {
    const res = await fetch('/data/document-content.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { html } = await res.json();
    el.innerHTML = `<div class="doc-inner">${html}</div>`;
  } catch (e) {
    console.error('Document load error:', e);
    el.innerHTML = '<div class="doc-loading">A dokumentum nem elérhető. Futtasd: <code>npm run process</code></div>';
  }
}

async function loadToc() {
  const tocEl = document.getElementById('docToc');
  try {
    const res = await fetch('/data/toc.json');
    TOC = await res.json();
    renderToc(tocEl);
  } catch (e) {
    tocEl.innerHTML = '<div style="padding:16px;color:#999;font-size:13px">TOC nem elérhető</div>';
  }
}

function renderToc(container) {
  let currentGroup = null;
  container.innerHTML = '';

  TOC.forEach(entry => {
    if (entry.level === 1) {
      currentGroup = document.createElement('div');
      currentGroup.className = 'toc-group';

      const link = document.createElement('a');
      link.className = 'toc-item level-1';
      link.href = `#${entry.id}`;
      link.textContent = entry.title;
      link.dataset.tocId = entry.id;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        scrollDocTo(entry.id);
        currentGroup.classList.toggle('collapsed');
      });
      currentGroup.appendChild(link);
      container.appendChild(currentGroup);
    } else if (entry.level === 2 && currentGroup) {
      const link = document.createElement('a');
      link.className = 'toc-item level-2';
      link.href = `#${entry.id}`;
      link.textContent = entry.title;
      link.dataset.tocId = entry.id;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        scrollDocTo(entry.id);
      });
      currentGroup.appendChild(link);
    }
  });
}

function scrollDocTo(id) {
  const docContent = document.getElementById('docContent');
  const target = docContent.querySelector(`#${CSS.escape(id)}`);
  if (!target) return;

  // Calculate offset within the scrollable container
  const containerRect = docContent.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const scrollTop = docContent.scrollTop + (targetRect.top - containerRect.top) - 20;

  docContent.scrollTo({
    top: scrollTop,
    behavior: 'smooth'
  });
}

// ========== INTERSECTION OBSERVER (active TOC) ==========
function initIntersectionObserver() {
  const docContent = document.getElementById('docContent');
  const headers = docContent.querySelectorAll('h1[id], h2[id]');
  if (headers.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          // Clear all active states
          document.querySelectorAll('.toc-item').forEach(el => el.classList.remove('active'));
          // Set active on matching TOC item
          const tocItem = document.querySelector(`.toc-item[data-toc-id="${id}"]`);
          if (tocItem) {
            tocItem.classList.add('active');
            // Scroll TOC sidebar to keep active item visible
            tocItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      });
    },
    { root: docContent, rootMargin: '0px 0px -75% 0px', threshold: 0 }
  );

  headers.forEach(h => observer.observe(h));
}

// ========== TF-IDF SEARCH ==========

// Simple Hungarian suffix removal for better matching
const HU_SUFFIXES = [
  // Case suffixes (longest first)
  'ekkel', 'okkal', 'ökkel', 'ákkal',
  'éssel', 'ással', 'onként', 'enként', 'önként',
  'ekkel', 'oknak', 'eknek', 'öknek',
  'okból', 'ekből', 'ökből', 'ából', 'éből',
  'okba', 'ekbe', 'ökbe', 'ába', 'ébe',
  'okon', 'eken', 'ökön', 'ákon', 'éken',
  'okra', 'ekre', 'ökre', 'ára', 'ére',
  'októl', 'ektől', 'öktől',
  'okért', 'ekért', 'ökért',
  'gyal', 'gyel', 'ggyal', 'ggyen', 'ggyel',
  'ával', 'ével', 'jával', 'jével',
  'nak', 'nek', 'ban', 'ben', 'ból', 'ből',
  'hoz', 'hez', 'höz', 'ról', 'ről', 'tól', 'től',
  'val', 'vel', 'ért', 'kor',
  'ból', 'ből', 'ból', 'nál', 'nél',
  'ba', 'be', 'ra', 're', 'on', 'en', 'ön',
  'ul', 'ül', 'ig', 'ká', 'ké',
  // Verb/adj suffixes
  'ási', 'ési', 'ási', 'ési',
  'unk', 'ünk', 'tok', 'tek', 'tök',
  'nak', 'nek', 'ják', 'jék',
  // Plural & possessive
  'okat', 'eket', 'öket', 'akat', 'jait', 'jeit',
  'ait', 'eit', 'jai', 'jei',
  'ai', 'ei', 'ok', 'ek', 'ök', 'ak',
  'ja', 'je', 'uk', 'ük',
  // Adjective
  'abb', 'ebb', 'obb',
  'ság', 'ség',
  'tás', 'tés',
  // Common endings
  'nak', 'nek', 'hoz', 'hez', 'höz',
  'ot', 'et', 'öt', 'at', 'ét',
  'át', 'ét',
  'an', 'en', 'ön',
  't', 'k',
];

function stemHu(word) {
  if (word.length < 4) return word;
  for (const suffix of HU_SUFFIXES) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function commonPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\wáéíóöőúüű]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function getRelevantChunks(query, topK = 6) {
  if (CHUNKS.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return CHUNKS.slice(0, topK);

  // Stem query tokens
  const queryStemsMap = {};
  queryTokens.forEach(qt => { queryStemsMap[qt] = stemHu(qt); });

  // Build document frequency
  const df = {};
  CHUNKS.forEach(chunk => {
    const tokens = new Set(tokenize(chunk.text + ' ' + chunk.section + ' ' + (chunk.keywords || []).join(' ')));
    tokens.forEach(t => { df[t] = (df[t] || 0) + 1; });
  });

  const N = CHUNKS.length;

  const scored = CHUNKS.map(chunk => {
    const chunkTokens = tokenize(chunk.text + ' ' + chunk.section + ' ' + (chunk.keywords || []).join(' '));
    const sectionTokens = new Set(tokenize(chunk.section));
    const tf = {};
    chunkTokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });

    // Also build stem-based tf
    const stemTf = {};
    chunkTokens.forEach(t => {
      const s = stemHu(t);
      stemTf[s] = (stemTf[s] || 0) + 1;
    });
    const sectionStems = new Set([...sectionTokens].map(stemHu));

    let score = 0;
    queryTokens.forEach(qt => {
      const qStem = queryStemsMap[qt];

      // Exact match
      if (tf[qt]) {
        const tfVal = tf[qt] / chunkTokens.length;
        const idfVal = Math.log(N / (1 + (df[qt] || 0)));
        score += tfVal * idfVal;
      }

      // Stem match (e.g. egészségüggyel -> egészségüg matches egészségügyi -> egészségügy)
      if (qStem.length >= 4 && stemTf[qStem] && !tf[qt]) {
        score += 0.8 * (stemTf[qStem] / chunkTokens.length) * Math.log(N / (1 + (df[qt] || 1)));
      }

      // Common prefix match (min 5 chars shared prefix)
      Object.keys(tf).forEach(ct => {
        if (ct === qt) return;
        const prefixLen = commonPrefixLen(qt, ct);
        const minLen = Math.min(qt.length, ct.length);
        if (prefixLen >= 5 && prefixLen >= minLen * 0.6) {
          const boost = 0.4 * (prefixLen / minLen);
          score += boost * (tf[ct] / chunkTokens.length) * Math.log(N / (1 + (df[ct] || 0)));
        }
      });
    });

    // Keyword bonus
    if (chunk.keywords) {
      queryTokens.forEach(qt => {
        const qStem = queryStemsMap[qt];
        if (chunk.keywords.some(kw => {
          if (kw.includes(qt) || qt.includes(kw)) return true;
          const kwStem = stemHu(kw);
          if (qStem.length >= 4 && (kwStem.startsWith(qStem) || qStem.startsWith(kwStem))) return true;
          return commonPrefixLen(qt, kw) >= 5;
        })) {
          score *= 1.3;
        }
      });
    }

    // Section name bonus: boost chunks whose section matches query stems
    queryTokens.forEach(qt => {
      const qStem = queryStemsMap[qt];
      if (sectionTokens.has(qt) || (qStem.length >= 4 && sectionStems.has(qStem))) {
        score *= 1.5;
      }
      // Also check prefix match against section tokens
      for (const st of sectionTokens) {
        if (commonPrefixLen(qt, st) >= 6) {
          score *= 1.4;
          break;
        }
      }
    });

    return { chunk, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .filter(s => s.score > 0)
    .map(s => s.chunk);
}

// ========== CHAT ==========
function initInput() {
  const input = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);
}

async function sendMessage(customQuery) {
  const input = document.getElementById('userInput');
  const query = customQuery || input.value.trim();
  if (!query) return;

  if (!checkRateLimit()) {
    showRateLimitWarning();
    return;
  }

  if (quickQuestionsVisible) {
    const qq = document.getElementById('quickQuestions');
    if (qq) qq.style.display = 'none';
    quickQuestionsVisible = false;
  }

  input.value = '';
  input.style.height = 'auto';

  addMessage('user', query);

  recordQuestion();
  updateRateLimitDisplay();

  // Get relevant chunks and store them for fallback
  const relevantChunks = getRelevantChunks(query, 6);
  lastSentChunks = relevantChunks;

  const typingEl = addTypingIndicator();

  const sendBtn = document.getElementById('sendBtn');
  sendBtn.disabled = true;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        history: conversationHistory.slice(-6),
        relevantChunks: relevantChunks.map(c => ({
          id: c.id,
          section: c.section,
          text: c.text,
        })),
      }),
    });

    const data = await response.json();
    typingEl.remove();

    if (data.error) {
      addMessage('bot', 'Hiba történt: ' + data.error);
    } else {
      // Determine chunk refs: use API refs, or fallback to TF-IDF top chunks
      let chunkRefs = data.chunkRefs || [];
      const hasInlineRefs = /\[chunk-\d+\]/.test(data.answer);

      if (chunkRefs.length === 0 && !hasInlineRefs && relevantChunks.length > 0) {
        // Fallback: append top TF-IDF chunk refs to the answer
        const fallbackChunks = relevantChunks.slice(0, 2);
        chunkRefs = fallbackChunks.map(c => c.id);
        const refTags = fallbackChunks.map(c => `[${c.id}]`).join('');
        data.answer = data.answer.trimEnd() + '\n' + refTags;
      }

      addMessage('bot', data.answer, chunkRefs);

      conversationHistory.push({ role: 'user', content: query });
      conversationHistory.push({ role: 'assistant', content: data.answer });

      if (conversationHistory.length > 12) {
        conversationHistory = conversationHistory.slice(-12);
      }

      // Auto-scroll to first chunk ref with 600ms delay
      if (chunkRefs.length > 0) {
        lastActiveChunkId = chunkRefs[0];
        setTimeout(() => scrollToChunk(chunkRefs[0]), 600);
      }
    }
  } catch (err) {
    typingEl.remove();
    addMessage('bot', 'Nem sikerült kapcsolódni a szerverhez. Kérlek próbáld újra később.');
  }

  sendBtn.disabled = false;
}

function addMessage(role, content, chunkRefs) {
  const container = document.getElementById('chatMessages');

  const msgDiv = document.createElement('div');
  msgDiv.className = role === 'user' ? 'user-message' : 'bot-message';

  if (role === 'user') {
    msgDiv.innerHTML = `
      <div class="user-avatar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v2h20v-2c0-3.3-6.7-5-10-5z"/>
        </svg>
      </div>
      <div class="message-content">${escapeHtml(content)}</div>
    `;
  } else {
    const formattedContent = formatBotMessage(content);
    msgDiv.innerHTML = `
      <div class="bot-avatar">T</div>
      <div class="message-content">${formattedContent}</div>
    `;
  }

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;

  // Attach click listeners to chunk refs
  if (role === 'bot') {
    msgDiv.querySelectorAll('.chunk-ref').forEach(el => {
      el.addEventListener('click', () => {
        const chunkId = el.dataset.chunk;
        lastActiveChunkId = chunkId;
        scrollToChunk(chunkId);
        // On mobile, switch to doc tab
        if (window.innerWidth <= 768) {
          switchTab('doc');
        }
      });
    });
  }
}

function formatBotMessage(text) {
  let html = escapeHtml(text);

  // Replace [chunk-XXX] with clickable pills
  html = html.replace(/\[chunk-(\d+)\]/g, (match, num) => {
    const chunkId = `chunk-${num}`;
    const chunk = CHUNKS.find(c => c.id === chunkId);
    const label = chunk ? chunk.section : `Forrás ${num}`;
    const shortLabel = label.length > 30 ? label.substring(0, 28) + '...' : label;
    return `<span class="chunk-ref" data-chunk="${chunkId}" title="${escapeHtml(label)}">&#x1F4C4; ${escapeHtml(shortLabel)}</span>`;
  });

  // Convert newlines to <br>
  html = html.replace(/\n/g, '<br>');

  return html;
}

function addTypingIndicator() {
  const container = document.getElementById('chatMessages');
  const typing = document.createElement('div');
  typing.className = 'bot-message';
  typing.innerHTML = `
    <div class="bot-avatar">T</div>
    <div class="message-content">
      <div class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  container.appendChild(typing);
  container.scrollTop = container.scrollHeight;
  return typing;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========== CHUNK SCROLL & HIGHLIGHT ==========
function scrollToChunk(chunkId) {
  const docContent = document.getElementById('docContent');
  const el = docContent.querySelector(`#${CSS.escape(chunkId)}`);
  if (!el) return;

  // Calculate offset within the scrollable container
  const containerRect = docContent.getBoundingClientRect();
  const targetRect = el.getBoundingClientRect();
  const scrollTop = docContent.scrollTop + (targetRect.top - containerRect.top) - (containerRect.height / 3);

  docContent.scrollTo({
    top: scrollTop,
    behavior: 'smooth'
  });

  // Highlight animation – 2 seconds
  el.classList.add('chunk-highlight');
  setTimeout(() => el.classList.add('fade'), 100);
  setTimeout(() => {
    el.classList.remove('chunk-highlight', 'fade');
  }, 2100);
}

// ========== DIVIDER DRAG ==========
function initDivider() {
  const divider = document.getElementById('divider');
  const chatPanel = document.getElementById('chatPanel');
  const container = document.querySelector('.split-container');
  let isDragging = false;

  divider.addEventListener('mousedown', (e) => {
    isDragging = true;
    divider.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const containerRect = container.getBoundingClientRect();
    const newWidth = e.clientX - containerRect.left;
    const minWidth = 320;
    const maxWidth = containerRect.width - 320;
    const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
    const percentage = (clampedWidth / containerRect.width) * 100;
    chatPanel.style.width = percentage + '%';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      divider.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  divider.addEventListener('touchstart', (e) => {
    isDragging = true;
    divider.classList.add('active');
    e.preventDefault();
  });

  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const containerRect = container.getBoundingClientRect();
    const newWidth = touch.clientX - containerRect.left;
    const minWidth = 320;
    const maxWidth = containerRect.width - 320;
    const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
    const percentage = (clampedWidth / containerRect.width) * 100;
    chatPanel.style.width = percentage + '%';
  });

  document.addEventListener('touchend', () => {
    if (isDragging) {
      isDragging = false;
      divider.classList.remove('active');
    }
  });
}

// ========== MOBILE TABS ==========
function initMobileTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active-tab'));
  document.querySelector(`.panel[data-tab="${tab}"]`).classList.add('active-tab');

  // When switching to doc tab and there's an active chunk, scroll to it
  if (tab === 'doc' && lastActiveChunkId) {
    setTimeout(() => scrollToChunk(lastActiveChunkId), 300);
  }
}

// ========== QUICK QUESTIONS ==========
function initQuickQuestions() {
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sendMessage(btn.dataset.q);
    });
  });
}

// ========== RATE LIMITING ==========
const RATE_LIMIT = 15;
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function getQuestionTimestamps() {
  try {
    const stored = localStorage.getItem('tisza_chat_timestamps');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function recordQuestion() {
  const timestamps = getQuestionTimestamps();
  timestamps.push(Date.now());
  localStorage.setItem('tisza_chat_timestamps', JSON.stringify(timestamps));
}

function checkRateLimit() {
  const now = Date.now();
  const timestamps = getQuestionTimestamps().filter(t => now - t < RATE_WINDOW);
  localStorage.setItem('tisza_chat_timestamps', JSON.stringify(timestamps));
  return timestamps.length < RATE_LIMIT;
}

function getRemainingQuestions() {
  const now = Date.now();
  const timestamps = getQuestionTimestamps().filter(t => now - t < RATE_WINDOW);
  return Math.max(0, RATE_LIMIT - timestamps.length);
}

function updateRateLimitDisplay() {
  const remaining = getRemainingQuestions();
  const el = document.getElementById('rateLimitInfo');
  if (remaining <= 5) {
    el.textContent = `${remaining}/${RATE_LIMIT} kérdés maradt ebben az órában`;
    el.style.color = remaining <= 2 ? '#D32F2F' : '#999';
  } else {
    el.textContent = '';
  }
}

function showRateLimitWarning() {
  addMessage('bot', 'Elérted az óránkénti kérdéskorlátot (15 kérdés/óra). Kérlek várj egy kicsit, és próbáld újra.');
}
