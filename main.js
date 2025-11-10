// main.js
(function () {
  // Берём конфиг из глобала
  const cfg = window.IntentBypassConfig || {};
  if (!cfg.intentTarget) {
    console.warn('[intent-opener] no intentTarget configured');
  }

  function log(...args) {
    if (cfg.debug) console.log('[intent-opener]', ...args);
  }

  function ua() {
    return navigator.userAgent || navigator.vendor || '';
  }
  function isAndroid() {
    return /Android/i.test(ua());
  }
  function isIOS() {
    return /iPhone|iPad|iPod/i.test(ua());
  }
  function isChromeLike() {
    return /Chrome\/|CriOS\//i.test(ua());
  }

  // Собираем intent ТАК ЖЕ, как у конкурентов (без encode внутри url)
  function makeIntentUrl(target) {
    let t = String(target || '').trim();
    if (!t) return '';
    if (!/^https?:\/\//i.test(t)) {
      t = 'https://' + t.replace(/^\/+/, '');
    }

    // если нужно приклеить текущий query:
    // const qs = window.location.search || '';
    // if (qs && !t.includes('?')) t += qs;
    // else if (qs) t += '&' + qs.slice(1);

    const intentUrl = `intent://navigate?url=${t}#Intent;scheme=googlechrome;end;`;
    log('built intentUrl:', intentUrl);
    return intentUrl;
  }

  function makeXSafariUrl(target) {
    let t = String(target || '').trim();
    if (!t) return '';
    t = t.replace(/^https?:\/\//i, '');
    const url = 'x-safari-https://' + t;
    log('built x-safari url:', url);
    return url;
  }

  function beacon(event, extra) {
    try {
      if (!cfg.beaconEndpoint) return;
      const payload = Object.assign({
        event,
        ts: Date.now(),
        ua: ua(),
        intentTarget: cfg.intentTarget
      }, extra || {});
      if (navigator.sendBeacon) {
        navigator.sendBeacon(cfg.beaconEndpoint, JSON.stringify(payload));
      } else {
        fetch(cfg.beaconEndpoint, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        }).catch(() => {});
      }
    } catch (e) {}
  }

  // ОДНА попытка открытия внешнего браузера
  function openExternalOnce(reason) {
    if (!cfg.intentTarget) {
      log('no intentTarget, skip openExternalOnce');
      return;
    }

    const target = cfg.intentTarget;
    const clean  = cfg.cleanTarget || cfg.intentTarget;
    const android = isAndroid();
    const ios = isIOS();
    let openUrl = clean;

    if (android && isChromeLike()) {
      openUrl = makeIntentUrl(target);
    } else if (ios) {
      openUrl = makeXSafariUrl(target);
    } else {
      openUrl = clean;
    }

    if (!openUrl) {
      log('openUrl empty, skipping');
      return;
    }

    beacon('intent_attempt', { reason, openUrl });

    try {
      log('window.open ->', openUrl);
      const w = window.open(openUrl, '_blank'); // КЛЮЧЕВОЕ — _blank
      log('window.open returned:', w);
    } catch (err) {
      log('window.open error', err);
      try {
        window.location.replace(clean);
      } catch (_) {
        window.location.href = clean;
      }
    }
  }

  // === Автоматическая попытка при загрузке (опционально) ===
  function autoAttempt() {
    if (!cfg.autoAttemptOnLoad) return;
    openExternalOnce('auto_on_load');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(autoAttempt, 50);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(autoAttempt, 50));
  }

  // === Любое действие пользователя → попытка вызова intent ===
  let lastTs = 0;
  const DEBOUNCE_MS = 50;

  function onUserInteraction(ev) {
    const now = Date.now();
    if (now - lastTs < DEBOUNCE_MS) return;
    lastTs = now;
    log('user interaction:', ev.type);
    openExternalOnce('user_' + ev.type);
  }

  const events = [
    'click',
    'touchstart',
    'touchend',
    'pointerdown',
    'pointerup',
    'keydown'
  ];

  events.forEach(evt => {
    window.addEventListener(evt, onUserInteraction, { passive: true });
  });

  // Для тестов из консоли
  window.__intentOpener = { openExternalOnce, cfg };
  log('intent-opener v_blank init', cfg);
})();
