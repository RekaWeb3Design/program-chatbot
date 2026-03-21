/**
 * jQuery Ripples — csak a .hero területén (#hero-ripples-target).
 * Eredeti CodePen-szerű beállítások; interactive: false + pointer csak a hero téglalapjában.
 */
(function () {
  if (window.matchMedia('(max-width: 768px)').matches) return;
  if (typeof jQuery === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var $bg = jQuery('#hero-ripples-target');
  if (!$bg.length) return;

  function heroContains(clientX, clientY) {
    var hero = document.querySelector('.hero');
    if (!hero) return false;
    var r = hero.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  try {
    $bg.ripples({
      resolution: 512,
      perturbance: 0.007,
      interactive: false
    });
  } catch (e) {
    console.warn('jquery.ripples init failed', e);
    return;
  }

  var last = 0;
  var THROTTLE_MS = 72;

  function dropAtEvent(e) {
    if (!heroContains(e.clientX, e.clientY)) return;

    var now = performance.now();
    if (e.type !== 'pointerdown' && now - last < THROTTLE_MS) return;
    last = now;

    var el = $bg[0];
    var rect = el.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;

    var radius = e.type === 'pointerdown' ? 12 : 5;
    var strength = e.type === 'pointerdown' ? 0.055 : 0.022;
    $bg.ripples('drop', x, y, radius, strength);
  }

  function onRippleResize() {
    try {
      $bg.ripples('updateSize');
    } catch (err) {
      /* ignore */
    }
  }

  var destroyed = false;
  function teardownRipples() {
    if (destroyed) return;
    destroyed = true;
    document.removeEventListener('pointermove', dropAtEvent, { passive: true });
    document.removeEventListener('pointerdown', dropAtEvent, { passive: true });
    window.removeEventListener('resize', onRippleResize, { passive: true });
    try {
      $bg.ripples('destroy');
    } catch (err) {
      /* ignore */
    }
  }

  document.addEventListener('pointermove', dropAtEvent, { passive: true });
  document.addEventListener('pointerdown', dropAtEvent, { passive: true });
  window.addEventListener('resize', onRippleResize, { passive: true });

  var mqMobile = window.matchMedia('(max-width: 768px)');
  function onViewportChange() {
    if (mqMobile.matches) teardownRipples();
  }
  if (mqMobile.addEventListener) {
    mqMobile.addEventListener('change', onViewportChange);
  } else {
    mqMobile.addListener(onViewportChange);
  }
})();
