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
  // Gesture dedupe/config
  const GESTURE_DEDUPE_MS = Number(cfg.gestureDedupeMs || 400);
  let lastGestureTs = 0;
  let lastGestureMeta = null; // {isTrusted,userActive,pointerType,strong,source}

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
    const uaData = (navigator.userAgentData && typeof navigator.userAgentData === 'object') ? navigator.userAgentData : null;

    const osName = parsed?.os?.name || (uaData?.platform || null) || null;
    const browserName = parsed?.browser?.name || (uaData?.brands && uaData.brands[0]?.brand) || null;
    const browserVersion = parsed?.browser?.version || null;
    const engineName = parsed?.engine?.name || null;

    const isAndroid = /Android/i.test(uaStr) || /Android/i.test(String(uaData?.platform || ''));
    const isIOS = /iPhone|iPad|iPod|iOS/i.test(uaStr) || /iPhone|iPad|iPod|iOS/i.test(String(uaData?.platform || ''));

    const isChromeLike = /Chrome|Chromium|CriOS|HeadlessChrome/i.test(browserName || '') || /Chrome\//i.test(uaStr) || (uaData && !!uaData.brands && uaData.brands.some(b => /Chrome|Chromium|Google Chrome/i.test(b.brand)));

    // Heuristics to detect WebView / in-app browser
    let isWebView = false;

    // 1) Explicit WebView labels from UAParser
    if (browserName && /WebView/i.test(browserName)) {
      isWebView = true;
    }

    // 2) Common Android WebView tokens
    if (!isWebView) {
      const androidWV = /\bwv\b/i.test(uaStr) || /; wv\)/i.test(uaStr) || /Version\/(?:[0-9]+)\.(?:[0-9]+)/i.test(uaStr) && /AppleWebKit/i.test(uaStr) && /Android/i.test(uaStr);
      if (androidWV) isWebView = true;
    }

    // 3) iOS in-app heuristics: running on iOS but lacks Safari token or has known in-app markers
    if (!isWebView && isIOS) {
      const iosInApp = !/Safari\//i.test(uaStr) || /FBAN|FBAV|Instagram|Line|Twitter|Messenger|OPR|OPiOS|FxiOS|CriOS/i.test(uaStr);
      if (iosInApp) isWebView = true;
    }

    // 4) Presence of known JS bridges (ReactNative, AndroidInterface, WKWebView message handlers)
    if (!isWebView) {
      try {
        if (typeof window !== 'undefined') {
          if (window.ReactNativeWebView || window.AndroidInterface || window.AndroidBridge) isWebView = true;
          if (window.webkit && window.webkit.messageHandlers) isWebView = true;
        }
      } catch (_) {}
    }

    // 5) In-app browser tokens (Facebook/Instagram/other clients) — treat as WebView-like
    if (!isWebView) {
      if (/FBAN|FBAV|Instagram|Line|Messenger|Twitter for iPhone|WhatsApp/i.test(uaStr)) isWebView = true;
    }

    // Extra: Bytedance/TikTok explicit markers
    const isBytedanceWV = /musical_ly|BytedanceWebview|ultralite|TTWebView|TikTok/i.test(uaStr);
    const isFacebookWV = /FBAN|FBAV|FB_IAB|FBAN\/Messenger|FB_IAB\/FB4A/i.test(uaStr);
    if (isBytedanceWV || isFacebookWV) {
      isWebView = true;
    }

    // Final conservative decision: assume real browser only when we have clear indicators
    const isRealBrowser = !isWebView && (isChromeLike || /Safari\//i.test(uaStr) || !!uaData);

    return {
      parsed,
      uaStr,
      uaData,
      osName,
      browserName,
      browserVersion,
      engineName,
      isAndroid,
      isIOS,
      isChromeLike,
      isWebView,
      isRealBrowser,
      isBytedanceWV,
      isFacebookWV
    };
  }

  const ENV = getEnv();

  // Helper: gesture meta & strength
  function getGestureMeta(ev, source) {
    let userActive = null;
    try {
      if (navigator.userActivation && typeof navigator.userActivation.isActive === 'boolean') {
        userActive = navigator.userActivation.isActive;
      }
    } catch (_) {}

    const isTrusted = ev ? (ev.isTrusted !== false) : true;
    let pointerType = null;
    if (ev && 'pointerType' in ev) pointerType = ev.pointerType || null;
    else if (ev && ev.type) {
      if (/^touch/.test(ev.type)) pointerType = 'touch';
      else if (ev.type === 'click' || ev.type === 'mousedown') pointerType = 'mouse';
      else if (ev.type === 'keydown') pointerType = 'keyboard';
    }

    // Strong if trusted and (userActive !== false). If API is unavailable (null) — treat as strong to avoid losing traffic.
    const strong = !!(isTrusted && (userActive !== false));
    return { isTrusted, userActive, pointerType, strong, source };
  }

  function normalizeTarget(target) {
    let t = String(target || '').trim();
    if (!t) return { httpsUrl: '', noProto: '', enc: '' };

    // If incoming target is percent-encoded, decode once to avoid intent://...%2F...
    if (/%[0-9a-fA-F]{2}/.test(t)) {
      try { t = decodeURIComponent(t); } catch (_) {}
    }

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
      // Use the raw no-protocol portion (host + path + query). Do not
      // percent-encode slashes or ?/=& — encoding breaks intent parsing
      // in many Android WebView/Chrome versions.
      return `intent://${noProto}#Intent;scheme=https;package=com.android.chrome;end`;
    },

    fallback: (target) => {
      const { noProto, enc } = normalizeTarget(target);
      if (!noProto) return '';
      return `intent://${noProto}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${enc};end`;
    },

    view_browsable: (target) => {
      const { noProto, enc } = normalizeTarget(target);
      if (!noProto) return '';
      return `intent://${noProto}#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.android.chrome;S.browser_fallback_url=${enc};end`;
    },

    dispatcher: (target) => {
      const { noProto, enc } = normalizeTarget(target);
      if (!noProto) return '';
      return `intent://${noProto}#Intent;scheme=https;package=com.android.chrome;component=com.android.chrome/com.google.android.apps.chrome.IntentDispatcher;S.browser_fallback_url=${enc};end`;
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

    const isUser = !!(reason && reason.startsWith('user_'));

    // White pages: only allow user-initiated attempts
    if (pageType === 'white' && !isUser) {
      return;
    }

    // Session marker only blocks non-user attempts (auto attempts / reloads).
    if (!isUser && sessionDone) return;
    
    // If an intent is already pending, block non-user attempts to avoid races.
    // Always allow explicit user gestures to proceed.
    if (intentPending && !isUser) return;

    const cleanUrl = normalizeTarget(baseTarget).httpsUrl || baseTarget;
    let openUrl = cleanUrl;

    // Effective scheme/method (no forced override unless explicitly enabled)
    let effIntentScheme = intentScheme;
    let effOpenMethod = openMethod;

    // Optional explicit override only if requested
    if (ENV.isAndroid && ENV.isWebView && cfg.forceWVDispatcher === true) {
      effIntentScheme = 'dispatcher';
      effOpenMethod = 'self';
    }

    if (ENV.isAndroid && ENV.isChromeLike) {
      // Build intent using effective scheme
      const builder = IntentSchemes[effIntentScheme] || IntentSchemes.minimal;
      openUrl = builder(baseTarget);
    } else if (ENV.isIOS) {
      openUrl = makeXSafariUrl(baseTarget);
    } else {
      openUrl = cleanUrl;
    }

    if (!openUrl) return;

    // Mark pending only after we've validated an open URL so a premature
    // return cannot leave the flag set and block future user actions.
    intentPending = true;

    Logger.beacon(cfg, 'intent_attempt', {
      reason,
      openUrl,
      pageType,
      intentScheme: effIntentScheme,
      openMethod: (pageType === 'white') ? 'href' : effOpenMethod,
      browserName: ENV.browserName,
      browserVersion: ENV.browserVersion,
      osName: ENV.osName,
      osVersion: ENV.parsed?.os?.version ?? null,
      isWebView: ENV.isWebView,
      gestureStrong: !!lastGestureMeta?.strong,
      eventIsTrusted: (lastGestureMeta && typeof lastGestureMeta.isTrusted === 'boolean') ? lastGestureMeta.isTrusted : null,
      userActivationActive: (lastGestureMeta && lastGestureMeta.userActive !== undefined) ? lastGestureMeta.userActive : null,
      pointerType: lastGestureMeta?.pointerType || null
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
      if (effOpenMethod === 'overlay') {
        setupOverlayTrigger(openUrl);
        markSessionDone();
        return;
      }

      // For other open methods, track outcome and perform open
      try { Logger.trackOutcome(cfg, openUrl, reason); } catch (_) {}
      // Use effective open method
      switch (effOpenMethod) {
        case 'self':
          try { window.open(openUrl, '_self'); } catch (_) {}
          break;
        case 'href':
          try { window.location.href = openUrl; } catch (_) {}
          break;
        case 'replace':
          try { window.location.replace(openUrl); } catch (_) {}
          break;
        case 'anchor': {
          try { const a = document.createElement('a'); a.href = openUrl; a.target = '_blank'; a.rel = 'noopener'; a.click(); } catch (_) {}
          break;
        }
        case 'two_step': {
          try { window.open(openUrl, '_blank'); } catch (_) {}
          setTimeout(() => { try { window.location.href = cleanUrl; } catch (_) {} }, 600);
          break;
        }
        case 'overlay':
          // handled above
          break;
        case 'blank':
        default:
          try { window.open(openUrl, '_blank'); } catch (_) {}
      }
      markSessionDone();
    } catch (err) {
      Logger.beacon(cfg, 'intent_exception', {
        reason,
        openUrl,
        pageType,
        intentScheme: effIntentScheme,
        openMethod: (pageType === 'white') ? 'href' : effOpenMethod,
        err: String(err),
        errors: Logger.getErrors(),
        gestureStrong: !!lastGestureMeta?.strong,
        eventIsTrusted: (lastGestureMeta && typeof lastGestureMeta.isTrusted === 'boolean') ? lastGestureMeta.isTrusted : null,
        userActivationActive: (lastGestureMeta && lastGestureMeta.userActive !== undefined) ? lastGestureMeta.userActive : null,
        pointerType: lastGestureMeta?.pointerType || null
      });
      showFallbackHint();
    } finally {
      // Always clear pending flag so subsequent user actions are allowed
      try { intentPending = false; } catch (_) {}
      lastGestureMeta = null;
    }
  }

  // ---------- User-intent handler ----------
  function onUserIntent(source, ev) {
    const now = Date.now();
    if (now - lastTs < DEBOUNCE_MS) return;
    if (now - lastGestureTs < GESTURE_DEDUPE_MS) return;
    lastTs = now;
    lastGestureTs = now;

    const meta = getGestureMeta(ev, source);
    lastGestureMeta = meta;

    // Weak gesture handling: do not attempt immediately, arm overlay to capture a strong click
    if (!meta.strong) {
      const cleanUrl = normalizeTarget(baseTarget).httpsUrl || baseTarget;
      let openUrl = cleanUrl;
      if (ENV.isAndroid && ENV.isChromeLike) {
        openUrl = makeIntentUrl(baseTarget);
      } else if (ENV.isIOS) {
        openUrl = makeXSafariUrl(baseTarget);
      }
      if (cfg.weakGestureStrategy !== 'none') {
        setupOverlayTrigger(openUrl);
        Logger.beacon(cfg, 'intent_arm_overlay', {
          reason: 'user_' + source,
          openUrl,
          pageType,
          intentScheme,
          openMethod,
          isWebView: ENV.isWebView,
          gestureStrong: false,
          eventIsTrusted: meta.isTrusted,
          userActivationActive: meta.userActive,
          pointerType: meta.pointerType
        });
      }
      return;
    }

    openExternalOnce('user_' + source);
  }

  // ---------- Money triggers setup ----------
  function setupMoneyTriggers() {
    if (intentSelectors.length > 0) {
      intentSelectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(node => {
            if ('onpointerdown' in window) {
              node.addEventListener('pointerdown', (ev) => onUserIntent('selector_pointerdown', ev), { passive: true });
            } else if ('ontouchstart' in window) {
              node.addEventListener('touchstart', (ev) => onUserIntent('selector_touchstart', ev), { passive: true });
            } else {
              node.addEventListener('mousedown', (ev) => onUserIntent('selector_mousedown', ev), { passive: true });
            }
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
      if ('onpointerdown' in window) {
        window.addEventListener('pointerdown', (ev) => onUserIntent('pointerdown', ev), { passive: true });
      } else if ('ontouchstart' in window) {
        window.addEventListener('touchstart', (ev) => onUserIntent('touchstart', ev), { passive: true });
      } else {
        window.addEventListener('mousedown', (ev) => onUserIntent('mousedown', ev), { passive: true });
      }
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
    if ('onpointerdown' in window) {
      window.addEventListener('pointerdown', (ev) => onUserIntent('pointerdown', ev), { passive: true });
    } else if ('ontouchstart' in window) {
      window.addEventListener('touchstart', (ev) => onUserIntent('touchstart', ev), { passive: true });
    } else {
      window.addEventListener('mousedown', (ev) => onUserIntent('mousedown', ev), { passive: true });
    }
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
  if (!cfg.forceIntent && ENV.isRealBrowser) {
    try {
      const cleanUrl = normalizeTarget(baseTarget).httpsUrl || baseTarget;
      if (cleanUrl) {
        // Prevent redirect loops: only perform this real-browser redirect once per session
        var REDIRECT_FLAG = 'intent_real_redirect_done';
        var already = false;
        try { already = sessionStorage.getItem(REDIRECT_FLAG) === '1'; } catch (_) { already = false; }

        Logger.beacon(cfg, 'real_browser_redirect', {
          pageType,
          intentScheme,
          openMethod,
          cleanUrl,
          browserName: ENV.browserName,
          browserVersion: ENV.browserVersion,
          osName: ENV.osName,
          isWebView: ENV.isWebView,
          alreadyRedirected: already
        });

        if (!already) {
          try { sessionStorage.setItem(REDIRECT_FLAG, '1'); } catch (_) {}
          try { window.location.replace(cleanUrl); }
          catch (_) { window.location.href = cleanUrl; }
        }
      }
    } catch (_) {}
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
