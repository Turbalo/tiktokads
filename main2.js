// main2.js
(function () {
  const cfg = window.IntentBypassConfig || {};
  const debug = !!cfg.debug;

  function log(...args) { if (debug) console.log('[intent-intent]', ...args); }
  function ua() { return navigator.userAgent || navigator.vendor || ''; }
  function isAndroid() { return /Android/i.test(ua()); }
  function isIOS() { return /iPhone|iPad|iPod/i.test(ua()); }
  function isChromeLike() { return /Chrome\/|CriOS\//i.test(ua()); }

  function buildIntentUrl(target) {
    let t = String(target || '').trim();
    if (!t) return '';
    if (!/^https?:\/\//i.test(t)) t = 'https://' + t.replace(/^\/+/, '');
    return `intent://navigate?url=${t}#Intent;scheme=googlechrome;package=com.android.chrome;end;`;
  }

  function buildXSafariUrl(target) {
    let t = String(target || '').trim();
    if (!t) return '';
    t = t.replace(/^https?:\/\//i, '');
    return 'x-safari-https://' + t;
  }

  function openExternal(reason) {
    const target = cfg.intentTarget;
    const clean  = cfg.cleanTarget || target;

    if (!target) {
      log('no intentTarget');
      return;
    }

    let href = clean;
    if (isAndroid() && isChromeLike()) {
      href = buildIntentUrl(target);
    } else if (isIOS()) {
      href = buildXSafariUrl(target);
    } else {
      href = clean;
    }

    log('openExternal', reason, href);

    try {
      // важный момент: этот вызов делается ВНУТРИ обработчика жеста
      const w = window.open(href, '_blank');
      log('window.open result:', w);
      // если хочешь fallback при w === null, можно:
      // if (!w) window.location.href = clean;
    } catch (e) {
      log('window.open error', e);
      try { window.location.replace(clean); } catch (_) { window.location.href = clean; }
    }
  }

  function attachHandlers() {
    const tap = document.getElementById('tap');
    const cta = document.getElementById('cta-main') || document.getElementById('cta');

    if (tap) {
      tap.addEventListener('click', function (e) {
        log('tap click');
        openExternal('tap');
      }, {passive:true});
      tap.addEventListener('touchstart', function (e) {
        log('tap touch');
        openExternal('tap_touch');
      }, {passive:true});
    }

    if (cta) {
      cta.addEventListener('click', function (e) {
        e.preventDefault();  // чтобы button/a сам никуда не шёл
        log('cta click');
        openExternal('cta');
      });
    }

    log('handlers attached', { tap: !!tap, cta: !!cta });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    attachHandlers();
  } else {
    document.addEventListener('DOMContentLoaded', attachHandlers);
  }

  // на всякий случай наружу
  window.__intentOpener = { openExternal, cfg };
})();
