// main.js
(function () {
  const cfg = window.IntentBypassConfig || {};

  const Logger = window.IntentBypassLogger || {
    hookErrors: () => {},
    beacon: () => {},
    trackOutcome: () => {},
    getErrors: () => []
  };

  if (!cfg.intentTarget) {
    console.warn('[intent-opener] no intentTarget configured');
  }

  // Per spec: intentTarget == cleanTarget and used for any page type
  const baseTarget = String(cfg.intentTarget || '').trim();

  // Page type: default "white"
  const pageType = String(cfg.pageType || 'white').toLowerCase(); // white | money

  // Intent scheme selector (4 canonical only)
  const intentScheme = String(cfg.intentScheme || 'minimal').toLowerCase();
  // minimal | fallback | view_browsable | dispatcher

  // Open method selector
  const openMethod = String(cfg.openMethod || 'blank').toLowerCase();
  // blank | self | href | replace | anchor | two_step | overlay

  // Money trigger settings
  const intentSelectors = Array.isArray(cfg.intentSelectors) ? cfg.intentSelectors : [];
  const fullscreenTrigger = cfg.fullscreenTrigger !== false; // default true for money

  // Auto attempt settings
  const autoOnLoad = !!cfg.autoAttemptOnLoad;
  let autoAttempted = false;

  // Debounce for user triggers
  const DEBOUNCE_MS = 50;
  let lastTs = 0;
  let intentPending = false;

  // One intent per session
  const SESSION_KEY = 'intent_done_session';
  let sessionDone = false;
  let canUseSessionStorage = false;
  
  try {
    // Test if sessionStorage is writable (private browsing might allow read but not write)
    const test = '__intent_test';
    sessionStorage.setItem(test, '1');
    sessionStorage.removeItem(test);
    canUseSessionStorage = true;
    sessionDone = sessionStorage.getItem(SESSION_KEY) === '1';
  } catch (_) {
    canUseSessionStorage = false;
  }

  function markSessionDone() {
    sessionDone = true;
    if (canUseSessionStorage) {
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (_) {}
    }
  }

  function log(...args) {
    if (cfg.debug) console.log('[intent-opener]', ...args);
  }

  // -------- Environment via UAParser --------
  function getEnv() {
    let parsed = null;
    try {
      if (typeof UAParser === "function") {
        parsed = new UAParser().getResult();
      }
    } catch (_) {}

    const uaStr = navigator.userAgent || '';

    const osName = parsed?.os?.name || null;
    const browserName = parsed?.browser?.name || null;
    const browserVersion = parsed?.browser?.version || null;
    const engineName = parsed?.engine?.name || null;

    const isAndroid = /Android/i.test(osName || uaStr);
    const isIOS = /iOS|iPhone|iPad|iPod/i.test(osName || uaStr);

    const isChromeLike =
      /Chrome|Chromium|Chrome WebView/i.test(browserName || '') ||
      /Chrome\/|CriOS\//i.test(uaStr);

    let isWebView = false;

    if (browserName && /WebView/i.test(browserName)) {
      isWebView = true;
    } else if (engineName && /WebView/i.test(engineName)) {
      isWebView = true;
    } else {
      const androidWV =
        /\bwv\b/i.test(uaStr) ||
        /; wv\)/i.test(uaStr) ||
        /Version\/4\.0/i.test(uaStr);

      const iosInApp =
        isIOS &&
        !/Safari\//i.test(uaStr) &&
        !/(?:UCBrowser|SamsungBrowser|EdgiOS|FxiOS|CriOS|OPiOS|Puffin|Mercury|Dolphin|QQBrowser)/i.test(uaStr);

      isWebView = androidWV || iosInApp;
    }

    return {
      parsed,
      uaStr,
      osName,
      browserName,
      browserVersion,
      engineName,
      isAndroid,
      isIOS,
      isChromeLike,
      isWebView,
      isRealBrowser: !isWebView
    };
  }

  const ENV = getEnv();

  function normalizeTarget(target) {
    let t = String(target || '').trim();
    if (!t) return { httpsUrl: '', noProto: '', enc: '' };
    if (!/^https?:\/\//i.test(t)) {
      t = 'https://' + t.replace(/\/+/g, '/').replace(/^\/+/, '');
    }
    const noProto = t.replace(/^https?:\/\//i, '');
    let enc = '';
    try {
      enc = encodeURIComponent(t);
    } catch (e) {
      enc = t;
    }
    return {
      httpsUrl: t,
      noProto,
      enc
    };
  }

  // ---------- Canonical intent builders ----------
  const IntentSchemes = {
    minimal: (target) => {
      const { noProto, enc } = normalizeTarget(target);
      if (!noProto) return '';
      // URL-encode the noProto to prevent query string injection
      const encoded = encodeURIComponent(noProto);
      return `intent://${encoded}#Intent;scheme=https;package=com.android.chrome;end`;
    },

    fallback: (target) => {
      const { noProto, enc } = normalizeTarget(target);
      if (!noProto) return '';
      const encoded = encodeURIComponent(noProto);
      return `intent://${encoded}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${enc};end`;
    },

    view_browsable: (target) => {
      const { noProto, enc } = normalizeTarget(target);
      if (!noProto) return '';
      const encoded = encodeURIComponent(noProto);
      return `intent://${encoded}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.android.chrome;S.browser_fallback_url=${enc};end`;
    },

    dispatcher: (target) => {
      const { noProto, enc } = normalizeTarget(target);
      if (!noProto) return '';
      const encoded = encodeURIComponent(noProto);
      return `intent://${encoded}#Intent;scheme=https;package=com.android.chrome;component=com.android.chrome/com.google.android.apps.chrome.IntentDispatcher;S.browser_fallback_url=${enc};end`;
    }
  };

  function makeIntentUrl(target) {
    const builder = IntentSchemes[intentScheme] || IntentSchemes.minimal;
    const intentUrl = builder(target);
    log('intentScheme:', intentScheme, 'intentUrl:', intentUrl);
    return intentUrl;
  }

  function makeXSafariUrl(target) {
    const { httpsUrl } = normalizeTarget(target);
    if (!httpsUrl) return '';
    const url = 'x-safari-https://' + httpsUrl.replace(/^https?:\/\//i, '');
    log('x-safari url:', url);
    return url;
  }

  // ---------- UI hint on failure ----------
  let hintShown = false;
  function showFallbackHint() {
    if (hintShown) return;
    if (!document.body) return;
    hintShown = true;

    const msg = cfg.fallbackHintText ||
      'If it does not open, tap the three dots in the top-right corner and choose "Open in browser".';

    const box = document.createElement('div');
    box.style.cssText = [
      'position:fixed',
      'left:0','right:0','bottom:0',
      'background:rgba(0,0,0,0.85)',
      'color:#fff',
      'padding:12px 14px',
      'font:14px/1.4 Arial, sans-serif',
      'z-index:2147483647'
    ].join(';');

    box.textContent = msg;
    try { document.body.appendChild(box); } catch (_) {}

    setTimeout(() => {
      try { box.remove(); } catch (_) {}
    }, cfg.fallbackHintMs || 6000);
  }

  // ---------- Open by method (money only) ----------
  function openByMethod(openUrl, cleanUrl) {
    switch (openMethod) {
      case 'self':
        try { window.open(openUrl, '_self'); } catch (_) {}
        return true;

      case 'href':
        try { window.location.href = openUrl; } catch (_) {}
        return true;

      case 'replace':
        try { window.location.replace(openUrl); } catch (_) {}
        return true;

      case 'anchor': {
        try {
          const a = document.createElement('a');
          a.href = openUrl;
          a.target = '_blank';
          a.rel = 'noopener';
          a.click();
        } catch (_) {}
        return true;
      }

      case 'two_step': {
        try { window.open(openUrl, '_blank'); } catch (_) {}
        setTimeout(() => {
          try { window.location.href = cleanUrl; } catch (_) {}
        }, 600);
        return true;
      }

      case 'overlay':
        return false;

      case 'blank':
      default:
        try { window.open(openUrl, '_blank'); } catch (_) {}
        return true;
    }
  }

  // ---------- Overlay trigger (full-screen <a>) ----------
  let overlayNode = null;
  let overlayTimer = null;

  function setupOverlayTrigger(openUrl) {
    if (overlayNode) return;
    if (!document.body) return;

    const a = document.createElement('a');
    a.href = openUrl;
    a.target = '_blank';
    a.rel = 'noopener';

    a.style.cssText = [
      'position:fixed',
      'top:0','left:0','right:0','bottom:0',
      'width:100%','height:100%',
      'z-index:2147483000',
      'background:transparent',
      'cursor:pointer'
    ].join(';');

    a.addEventListener('click', (ev) => {
      // Now track outcome after user clicks overlay
      try { Logger.trackOutcome(cfg, openUrl, 'overlay_click'); } catch (_) {}
      onUserIntent('overlay_click', ev);
    }, { passive: true });

    overlayNode = a;
    try {
      document.body.appendChild(a);
    } catch (_) {}

    // Auto-remove overlay after 30 seconds if not clicked
    overlayTimer = setTimeout(() => removeOverlayTrigger(), 30000);
  }

  function removeOverlayTrigger() {
    if (overlayTimer) clearTimeout(overlayTimer);
    if (!overlayNode) return;
    try { overlayNode.remove(); } catch (_) {}
    overlayNode = null;
    overlayTimer = null;
  }

  // ---------- Main opening routine ----------
  function openExternalOnce(reason) {
    if (!baseTarget) return;

    // White pages: only one attempt, only by real user gesture
    if (pageType === 'white' && !(reason && reason.startsWith('user_'))) {
      return;
    }

    // Now check sessionDone and intentPending (after filtering out non-gesture white page attempts)
    if (sessionDone || intentPending) return;
    intentPending = true;

    const cleanUrl = normalizeTarget(baseTarget).httpsUrl || baseTarget;
    let openUrl = cleanUrl;

    if (ENV.isAndroid && ENV.isChromeLike) {
      openUrl = makeIntentUrl(baseTarget);
    } else if (ENV.isIOS) {
      openUrl = makeXSafariUrl(baseTarget);
    } else {
      openUrl = cleanUrl;
    }

    if (!openUrl) return;

    Logger.beacon(cfg, 'intent_attempt', {
      reason,
      openUrl,
      pageType,
      intentScheme,
      openMethod: (pageType === 'white') ? 'href' : openMethod,
      browserName: ENV.browserName,
      browserVersion: ENV.browserVersion,
      osName: ENV.osName,
      osVersion: ENV.parsed?.os?.version ?? null,
      isWebView: ENV.isWebView
    });

    try {
      // White pages: forced location.href, ignore openMethod
      if (pageType === 'white') {
        try { Logger.trackOutcome(cfg, openUrl, reason); } catch (_) {}
        try { window.location.href = openUrl; } catch (_) {}
        markSessionDone();
        return;
      }

      // Money pages: overlay mode creates a full-screen <a>
      // Do NOT call trackOutcome for overlay; it will be called after user clicks overlay
      if (openMethod === 'overlay') {
        setupOverlayTrigger(openUrl);
        markSessionDone();
        return;
      }

      // For other open methods, track outcome and perform open
      try { Logger.trackOutcome(cfg, openUrl, reason); } catch (_) {}
      openByMethod(openUrl, cleanUrl);
      markSessionDone();
    } catch (err) {
      Logger.beacon(cfg, 'intent_exception', {
        reason,
        openUrl,
        pageType,
        intentScheme,
        openMethod: (pageType === 'white') ? 'href' : openMethod,
        err: String(err),
        errors: Logger.getErrors()
      });
      showFallbackHint();
    }
  }

  // ---------- User-intent handler ----------
  function onUserIntent(source, ev) {
    const now = Date.now();
    if (now - lastTs < DEBOUNCE_MS) return;
    lastTs = now;

    openExternalOnce('user_' + source);
  }

  // ---------- Money triggers setup ----------
  function setupMoneyTriggers() {
    if (intentSelectors.length > 0) {
      intentSelectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(node => {
            node.addEventListener('click', (ev) => onUserIntent('selector_click', ev), { passive: true });
            node.addEventListener('touchstart', (ev) => onUserIntent('selector_touchstart', ev), { passive: true });
            // Add keyboard support for selector-based triggers
            node.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                onUserIntent('selector_keydown', ev);
              }
            }, { passive: true });
          });
        } catch (_) {}
      });
      return;
    }

    if (fullscreenTrigger) {
      window.addEventListener('click', (ev) => onUserIntent('click', ev), { passive: true });
      window.addEventListener('touchstart', (ev) => onUserIntent('touchstart', ev), { passive: true });
      // Filter keydown to only Enter and Space to avoid capturing system shortcuts
      window.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          onUserIntent('keydown', ev);
        }
      }, { passive: true });
    }
  }

  // ---------- White triggers setup ----------
  function setupWhiteTriggers() {
    window.addEventListener('click', (ev) => onUserIntent('click', ev), { passive: true });
    window.addEventListener('touchstart', (ev) => onUserIntent('touchstart', ev), { passive: true });
    // Filter keydown to only Enter and Space to avoid capturing system shortcuts
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        onUserIntent('keydown', ev);
      }
    }, { passive: true });
  }

  // ---------- Auto attempt behavior ----------
  function autoAttempt() {
    if (!autoOnLoad || autoAttempted || sessionDone) return;
    autoAttempted = true;

    // White pages: never auto-attempt
    if (pageType === 'white') return;

    // Money pages: one auto attempt (may create overlay if openMethod=overlay)
    openExternalOnce('auto_on_load');
  }

  // ---------- Stop intent logic in real browsers ----------
  if (ENV.isRealBrowser) {
    const cleanUrl = normalizeTarget(baseTarget).httpsUrl || baseTarget;
    if (cleanUrl) {
      Logger.beacon(cfg, 'real_browser_redirect', {
        pageType,
        intentScheme,
        openMethod,
        cleanUrl,
        browserName: ENV.browserName,
        browserVersion: ENV.browserVersion,
        osName: ENV.osName,
        isWebView: ENV.isWebView
      });
      try { window.location.replace(cleanUrl); }
      catch (_) { window.location.href = cleanUrl; }
    }
    return;
  }

  // ---------- Init ----------
  // Prevent duplicate initialization on SPA navigation or multiple script loads
  if (window.__intentOpenerInitialized) return;
  window.__intentOpenerInitialized = true;

  Logger.hookErrors(cfg);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(autoAttempt, 50);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(autoAttempt, 50));
  }

  if (pageType === 'money') {
    setupMoneyTriggers();
  } else {
    setupWhiteTriggers();
  }

  // Expose for console tests
  window.__intentOpener = {
    openExternalOnce,
    cfg,
    IntentSchemes,
    ENV,
    removeOverlayTrigger
  };

  log('intent-opener init', {
    pageType,
    intentScheme,
    openMethod,
    fullscreenTrigger,
    intentSelectors,
    isWebView: ENV.isWebView
  });
})();
