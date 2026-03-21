// ========== STATE ==========
let CHUNKS_META = []; // lightweight: [{id, section}]
let TOC = [];
let sessionId = sessionStorage.getItem('tisza_session') || null;
let quickQuestionsVisible = true;
let lastActiveChunkId = null;

// ========== INIT ==========
async function initApp() {
  if (typeof window !== 'undefined' && window.__TISZA_CHATBOT_INIT__) return;
  if (typeof window !== 'undefined') window.__TISZA_CHATBOT_INIT__ = true;

  await loadChunksMeta();
  await loadDocument();
  initIntersectionObserver();
  await loadToc();
  initDivider();
  initInput();
  initMobileTabs();
  initQuickQuestions();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void initApp(), { once: true });
} else {
  void initApp();
}

// ========== DATA LOADING ==========
async function loadChunksMeta() {
  try {
    const res = await fetch('/data/chunks-meta.json');
    CHUNKS_META = await res.json();
  } catch (e) {
    console.warn('chunks-meta.json not found');
    CHUNKS_META = [];
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
    el.innerHTML = '<div class="doc-loading">A dokumentum nem elérhető.</div>';
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

  const containerRect = docContent.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const scrollTop = docContent.scrollTop + (targetRect.top - containerRect.top) - 20;

  docContent.scrollTo({ top: scrollTop, behavior: 'smooth' });
}

// ========== INTERSECTION OBSERVER ==========
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
          if (tocItem) {
            tocItem.classList.add('active');
            tocItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      });
    },
    { root: docContent, rootMargin: '0px 0px -75% 0px', threshold: 0 }
  );

  headers.forEach(h => observer.observe(h));
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
  const query = (typeof customQuery === 'string' ? customQuery : '') || input.value.trim();
  if (!query) return;

  if (quickQuestionsVisible) {
    const qq = document.getElementById('quickQuestions');
    if (qq) qq.style.display = 'none';
    quickQuestionsVisible = false;
  }

  input.value = '';
  input.style.height = 'auto';

  addMessage('user', query);

  const typingEl = addTypingIndicator();
  const sendBtn = document.getElementById('sendBtn');
  sendBtn.disabled = true;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        sessionId,
      }),
    });

    // Check if SSE stream
    const contentType = response.headers.get('Content-Type') || '';

    if (contentType.includes('text/event-stream')) {
      // ── SSE streaming response ──
      typingEl.remove();
      const { msgEl, contentEl } = addStreamingMessage();

      let fullText = '';
      let chunkRefs = [];

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            var currentEvent = line.slice(7).trim();
          }
          if (!line.startsWith('data: ')) continue;

          const data = line.slice(6).trim();
          try {
            const parsed = JSON.parse(data);

            switch (currentEvent) {
              case 'session':
                sessionId = parsed.sessionId;
                sessionStorage.setItem('tisza_session', sessionId);
                break;

              case 'sources':
                // Sources received — could show preview
                break;

              case 'delta':
                fullText += parsed.text;
                contentEl.innerHTML = formatBotMessage(fullText);
                // Keep scrolled to bottom
                const container = document.getElementById('chatMessages');
                container.scrollTop = container.scrollHeight;
                break;

              case 'done':
                chunkRefs = parsed.chunkRefs || [];
                break;

              case 'error':
                fullText = parsed.message || 'Hiba történt.';
                contentEl.innerHTML = formatBotMessage(fullText);
                break;
            }
          } catch (_) { /* skip malformed JSON */ }
        }
      }

      // Finalize: attach click handlers to chunk refs
      contentEl.innerHTML = formatBotMessage(fullText);
      attachChunkRefListeners(msgEl);

      // Auto-scroll to first chunk
      if (chunkRefs.length > 0) {
        lastActiveChunkId = chunkRefs[0];
        setTimeout(() => scrollToChunk(chunkRefs[0]), 600);
      }

    } else {
      // ── JSON response (error or blocked) ──
      typingEl.remove();
      const data = await response.json();
      if (data.error === 'blocked' || data.error === 'rate_limit') {
        addMessage('bot', data.message);
      } else if (data.error) {
        addMessage('bot', 'Hiba történt: ' + (data.message || data.error));
      } else {
        addMessage('bot', data.answer || 'Nem sikerült választ generálni.');
      }
    }

  } catch (err) {
    typingEl.remove();
    addMessage('bot', 'Nem sikerült kapcsolódni a szerverhez. Kérlek próbáld újra később.');
  }

  sendBtn.disabled = false;
}

// ========== MESSAGE RENDERING ==========

function addMessage(role, content) {
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
    msgDiv.innerHTML = `
      <div class="bot-avatar">T</div>
      <div class="message-content">${formatBotMessage(content)}</div>
    `;
    // Attach click listeners after adding to DOM
    setTimeout(() => attachChunkRefListeners(msgDiv), 0);
  }

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function addStreamingMessage() {
  const container = document.getElementById('chatMessages');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'bot-message';
  msgDiv.innerHTML = `
    <div class="bot-avatar">T</div>
    <div class="message-content"></div>
  `;
  container.appendChild(msgDiv);

  return {
    msgEl: msgDiv,
    contentEl: msgDiv.querySelector('.message-content'),
  };
}

function chunkIdToSection(chunkId) {
  const meta = CHUNKS_META.find(c => c.id === chunkId);
  return meta ? meta.section : null;
}

function formatBotMessage(text) {
  let html = escapeHtml(text);

  // Replace (forrás: [chunk-XXXX]) with section name badge
  html = html.replace(/\s*\(forrás:\s*\[chunk-(\d{3,4})\]\)/g, (_, num) => {
    const section = chunkIdToSection(`chunk-${num}`);
    return section ? ` <span class="source-badge">${escapeHtml(section)}</span>` : '';
  });

  // Replace (section name) [chunk-XXXX] with section name badge
  html = html.replace(/\s*\([^)]*\)\s*\[chunk-(\d{3,4})\]/g, (_, num) => {
    const section = chunkIdToSection(`chunk-${num}`);
    return section ? ` <span class="source-badge">${escapeHtml(section)}</span>` : '';
  });

  // Replace standalone [chunk-XXXX] with section name badge
  html = html.replace(/\s*\[chunk-(\d{3,4})\]/g, (_, num) => {
    const section = chunkIdToSection(`chunk-${num}`);
    return section ? ` <span class="source-badge">${escapeHtml(section)}</span>` : '';
  });

  // Style quoted text as clickable blockquotes
  // Match „..."\u201D and „..." style quotes (GPT uses \u201E open + \u201D close)
  html = html.replace(/\u201E([^\u201D"]+)[\u201D"]/g, (match, quote) => {
    return `<blockquote class="doc-quote">${quote}</blockquote>`;
  });

  // Also match &quot;...&quot; style quotes (fallback)
  html = html.replace(/&quot;([^&]+)&quot;/g, (match, quote) => {
    return `<blockquote class="doc-quote">${quote}</blockquote>`;
  });

  // Convert newlines to <br>
  html = html.replace(/\n/g, '<br>');

  return html;
}

function attachChunkRefListeners(msgEl) {
  msgEl.querySelectorAll('.doc-quote').forEach(el => {
    el.style.cursor = 'pointer';
    el.title = 'Kattints a szöveg megkereséséhez a dokumentumban';
    el.addEventListener('click', () => {
      // Search for this text in the document
      const quoteText = el.textContent.trim();
      scrollToTextInDoc(quoteText);
      if (window.innerWidth <= 768) {
        switchTab('doc');
      }
    });
  });
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

// ========== DOCUMENT SCROLL & HIGHLIGHT ==========

function scrollToChunk(chunkId) {
  const docContent = document.getElementById('docContent');
  const el = docContent.querySelector(`#${CSS.escape(chunkId)}`);
  if (!el) return;

  const containerRect = docContent.getBoundingClientRect();
  const targetRect = el.getBoundingClientRect();
  const scrollTop = docContent.scrollTop + (targetRect.top - containerRect.top) - (containerRect.height / 3);

  docContent.scrollTo({ top: scrollTop, behavior: 'smooth' });

  el.classList.add('chunk-highlight');
  setTimeout(() => el.classList.add('fade'), 100);
  setTimeout(() => el.classList.remove('chunk-highlight', 'fade'), 2100);
}

function clearDocHighlights() {
  const docContent = document.getElementById('docContent');
  if (!docContent) return;
  docContent.querySelectorAll('mark.text-highlight').forEach(m => {
    m.replaceWith(m.textContent);
  });
  // Normalize to merge adjacent text nodes back together
  docContent.normalize();
}

function scrollToTextInDoc(searchText) {
  const docContent = document.getElementById('docContent');
  if (!docContent) return;

  // Clear previous highlight
  clearDocHighlights();

  const needle = searchText.toLowerCase().trim();

  // Search through all text-containing elements
  const elements = docContent.querySelectorAll('p, li');
  for (const el of elements) {
    if (!el.textContent.toLowerCase().includes(needle)) continue;

    // Wrap matching text with <mark>
    highlightTextInElement(el, needle);

    const mark = el.querySelector('mark.text-highlight');
    const scrollTarget = mark || el;

    const containerRect = docContent.getBoundingClientRect();
    const targetRect = scrollTarget.getBoundingClientRect();
    const scrollTop = docContent.scrollTop + (targetRect.top - containerRect.top) - (containerRect.height / 3);

    docContent.scrollTo({ top: scrollTop, behavior: 'smooth' });
    return;
  }
}

function highlightTextInElement(el, needle) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  // Build full text map from text nodes
  let fullText = '';
  const nodeMap = [];
  for (const node of textNodes) {
    const start = fullText.length;
    fullText += node.textContent;
    nodeMap.push({ node, start, end: fullText.length });
  }

  const matchStart = fullText.toLowerCase().indexOf(needle);
  if (matchStart === -1) return;
  const matchEnd = matchStart + needle.length;

  // Wrap matching text nodes (iterate backwards to preserve indices)
  for (let i = nodeMap.length - 1; i >= 0; i--) {
    const { node, start, end } = nodeMap[i];
    if (end <= matchStart || start >= matchEnd) continue;

    const relStart = Math.max(0, matchStart - start);
    const relEnd = Math.min(node.textContent.length, matchEnd - start);

    const before = node.textContent.slice(0, relStart);
    const matched = node.textContent.slice(relStart, relEnd);
    const after = node.textContent.slice(relEnd);

    const mark = document.createElement('mark');
    mark.className = 'text-highlight';
    mark.textContent = matched;

    const parent = node.parentNode;
    if (after) parent.insertBefore(document.createTextNode(after), node.nextSibling);
    parent.insertBefore(mark, node.nextSibling);
    if (before) parent.insertBefore(document.createTextNode(before), mark);
    parent.removeChild(node);
  }
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
    chatPanel.style.width = (clampedWidth / containerRect.width) * 100 + '%';
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
    chatPanel.style.width = (clampedWidth / containerRect.width) * 100 + '%';
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
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active-tab'));
  document.querySelector(`.panel[data-tab="${tab}"]`).classList.add('active-tab');

  if (tab === 'doc' && lastActiveChunkId) {
    setTimeout(() => scrollToChunk(lastActiveChunkId), 300);
  }
}

// ========== QUICK QUESTIONS ==========
function initQuickQuestions() {
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => sendMessage(btn.dataset.q));
  });
}
