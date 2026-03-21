(function () {
  const TARGET = new Date('2026-04-12T19:00:00+02:00');

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function showExpired(aside) {
    aside.innerHTML =
      '<div class="countdown-bar__inner countdown-bar__inner--expired">' +
      '<p class="countdown-bar__expired">2026. április 12. · Ma van a választás.</p>' +
      '</div>';
  }

  function tick(aside, intervalId) {
    let ms = TARGET.getTime() - Date.now();
    if (ms <= 0) {
      clearInterval(intervalId);
      showExpired(aside);
      return;
    }

    const days = Math.floor(ms / 86400000);
    ms %= 86400000;
    const hours = Math.floor(ms / 3600000);
    ms %= 3600000;
    const minutes = Math.floor(ms / 60000);
    ms %= 60000;
    const seconds = Math.floor(ms / 1000);

    const d = aside.querySelector('[data-cd="days"]');
    const h = aside.querySelector('[data-cd="hours"]');
    const m = aside.querySelector('[data-cd="minutes"]');
    const s = aside.querySelector('[data-cd="seconds"]');
    if (d) d.textContent = String(days);
    if (h) h.textContent = pad2(hours);
    if (m) m.textContent = pad2(minutes);
    if (s) s.textContent = pad2(seconds);
  }

  function initOne(aside) {
    const intervalId = setInterval(function () {
      tick(aside, intervalId);
    }, 1000);
    tick(aside, intervalId);
  }

  function run() {
    document.querySelectorAll('[data-countdown]').forEach(initOne);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
})();
