// ========== STATE ==========
let CHUNKS = [];
let TOC = [];
let conversationHistory = [];
let quickQuestionsVisible = true;

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', async () => {
  await loadChunks();
  await loadDocument();
  await loadToc();
  initDivider();
  initInput();
  initMobileTabs();
  initQuickQuestions();
  updateRateLimitDisplay();
});

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
  const docContent = document.getElementById('docContent');
  try {
    const res = await fetch('/data/document.html');
    const html = await res.text();
    // Extract body content from full HTML
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const inner = bodyMatch ? bodyMatch[1] : html;
    docContent.innerHTML = `<div class="doc-inner">${inner}</div>`;
    initIntersectionObserver();
  } catch (e) {
    docContent.innerHTML = '<div class="doc-loading">A dokumentum nem elérhető. Futtasd: <code>npm run process</code></div>';
  }
}

async function loadToc() {
  const tocEl = document.getElementById('docToc');
  try {
    const res = await fetch('/data/toc.json');
    TOC = await res.json();
    renderToc(tocEl);
  } catch (e) {
    tocEl.innerHTML = '<div style="padding:16px;color:#999;font-size:12px">TOC nem elérhető</div>';
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
        // Toggle collapse
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
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
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
          document.querySelectorAll('.toc-item').forEach(el => el.classList.remove('active'));
          const tocItem = document.querySelector(`.toc-item[data-toc-id="${id}"]`);
          if (tocItem) tocItem.classList.add('active');
        }
      });
    },
    { root: docContent, rootMargin: '-10% 0px -80% 0px', threshold: 0 }
  );

  headers.forEach(h => observer.observe(h));
}

// ========== TF-IDF SEARCH ==========
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

  // Build document frequency
  const df = {};
  CHUNKS.forEach(chunk => {
    const tokens = new Set(tokenize(chunk.text + ' ' + chunk.section + ' ' + (chunk.keywords || []).join(' ')));
    tokens.forEach(t => { df[t] = (df[t] || 0) + 1; });
  });

  const N = CHUNKS.length;

  // Score each chunk
  const scored = CHUNKS.map(chunk => {
    const chunkTokens = tokenize(chunk.text + ' ' + chunk.section + ' ' + (chunk.keywords || []).join(' '));
    const tf = {};
    chunkTokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });

    let score = 0;
    queryTokens.forEach(qt => {
      if (tf[qt]) {
        const tfVal = tf[qt] / chunkTokens.length;
        const idfVal = Math.log(N / (1 + (df[qt] || 0)));
        score += tfVal * idfVal;
      }
      // Partial matching bonus
      Object.keys(tf).forEach(ct => {
        if (ct !== qt && (ct.startsWith(qt) || qt.startsWith(ct))) {
          score += 0.3 * (tf[ct] / chunkTokens.length) * Math.log(N / (1 + (df[ct] || 0)));
        }
      });
    });

    // Keyword bonus
    if (chunk.keywords) {
      queryTokens.forEach(qt => {
        if (chunk.keywords.some(kw => kw.includes(qt) || qt.includes(kw))) {
          score *= 1.3;
        }
      });
    }

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

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // Enter to send (Shift+Enter for newline)
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

  // Rate limit check
  if (!checkRateLimit()) {
    showRateLimitWarning();
    return;
  }

  // Hide quick questions
  if (quickQuestionsVisible) {
    const qq = document.getElementById('quickQuestions');
    if (qq) qq.style.display = 'none';
    quickQuestionsVisible = false;
  }

  // Clear input
  input.value = '';
  input.style.height = 'auto';

  // Add user message
  addMessage('user', query);

  // Record rate limit
  recordQuestion();
  updateRateLimitDisplay();

  // Get relevant chunks
  const relevantChunks = getRelevantChunks(query, 6);

  // Show typing indicator
  const typingEl = addTypingIndicator();

  // Disable input
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

    // Remove typing indicator
    typingEl.remove();

    if (data.error) {
      addMessage('bot', 'Hiba történt: ' + data.error);
    } else {
      addMessage('bot', data.answer, data.chunkRefs);

      // Update conversation history
      conversationHistory.push({ role: 'user', content: query });
      conversationHistory.push({ role: 'assistant', content: data.answer });

      // Keep max 6 messages in history
      if (conversationHistory.length > 12) {
        conversationHistory = conversationHistory.slice(-12);
      }

      // Auto-scroll to first chunk ref
      if (data.chunkRefs && data.chunkRefs.length > 0) {
        setTimeout(() => scrollToChunk(data.chunkRefs[0]), 500);
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
  // Escape HTML first
  let html = escapeHtml(text);

  // Replace [chunk-XXX] with clickable pills
  html = html.replace(/\[chunk-(\d+)\]/g, (match, num) => {
    const chunkId = `chunk-${num}`;
    const chunk = CHUNKS.find(c => c.id === chunkId);
    const label = chunk ? chunk.section : `Forrás ${num}`;
    // Truncate long section names
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

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Highlight animation
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

  // Touch support
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
