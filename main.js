(function (win, doc) {
  'use strict';

  if (win.__mainIntentInitialized) {
    return;
  }
  win.__mainIntentInitialized = true;

  // ===== CONFIG =====

  var defaultCfg = {
    page: 'white',                 // 'money' или 'white' (по умолчанию — white)
    intentTarget: '',              // что открывать через intent
    cleanTarget: '',               // куда редиректить в нормальном браузере
    autoAttemptOnLoad: false,      // main.js сам по себе не обязан что-то делать на загрузке
    repeatEveryMs: 0,              // для main.js можно игнорировать (оставлено на будущее)
    repeatMaxMs: 0,
    userActionEvents: ['pointerdown', 'touchstart', 'click'],
    debug: false
  };

  var userCfg = win.IntentBypassConfig || {};
  // userCfg переопределяет defaultCfg
  var cfg = Object.assign({}, defaultCfg, userCfg);

  function log() {
    if (!cfg.debug || !win.console || !console.log) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[main.js]');
    console.log.apply(console, args);
  }

  var currentUrl = win.location.href;

  // intentTarget:
  //  - для white: обычно текущий URL
  //  - для money: часто тоже текущий URL (LP), а cleanTarget — {offer_link}
  var intentTarget = cfg.intentTarget || currentUrl;

  // cleanTarget:
  //  - для white: по дефолту тот же URL
  //  - для money: по идее должен быть {offer_link}, но если не задан — хотя бы intentTarget
  var cleanTarget;
  if (cfg.page === 'money') {
    cleanTarget = cfg.cleanTarget || cfg.intentTarget || currentUrl;
  } else {
    cleanTarget = cfg.cleanTarget || intentTarget || currentUrl;
  }

  // ===== ENV DETECTION =====

  function detectEnv() {
    var ua = (win.navigator && win.navigator.userAgent) || '';

    var isAndroid = /Android/i.test(ua);
    var isIOS = /(iPhone|iPad|iPod|iOS)/i.test(ua);

    // TikTok / Bytedance / generic WebView маркеры
    var isTikTok = /tiktok|musical_ly/i.test(ua);
    var isBytedance = /bytedance|aweme|lark/i.test(ua);
    var hasWV = /\bwv\)/i.test(ua);

    // Типичный Android WebView: "... Version/X.X Chrome/XX Mobile Safari/XX; wv)"
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

  // ===== HELPERS =====

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

    // Классический Chrome intent
    return 'intent://' + base +
      '#Intent;' +
      'scheme=' + scheme + ';' +
      'S.browser_fallback_url=' + encodeURIComponent(fb) + ';' +
      'end;';
  }

  // ===== CORE LOGIC =====

  // Открыть "наружу" из WebView (white + money одинаково)
  function openExternalFromWebView(reason) {
    log('openExternalFromWebView, reason:', reason, 'env.isWebView=', env.isWebView);
    if (!env.isWebView) {
      return;
    }

    // Для white и money intentTarget = текущий (или заданный) URL LP
    var target = intentTarget || currentUrl;

    if (env.isAndroid) {
      var intentUrl = buildChromeIntent(target, target);
      if (!intentUrl) {
        // если интент собрать не удалось — просто обычный переход
        navigate(target);
        return;
      }
      navigate(intentUrl);
      return;
    }

    if (env.isIOS) {
      // iOS всё равно покажет свою "выйти из приложения?" / "открыть в браузере?"
      navigate(target);
      return;
    }

    // Остальные случаи WebView — обычный переход, контейнер сам спросит/откроет
    navigate(target);
  }

  // Обработка действий пользователя
  var fired = false;
  function onUserAction(ev) {
    if (fired) return;
    fired = true;

    // РЕЖИМ WEBVIEW: всегда пытаемся вытащить наружу
    if (env.isWebView) {
      ev && ev.preventDefault && ev.preventDefault();
      openExternalFromWebView('user-action');
      return;
    }

    // РЕЖИМ ОБЫЧНОГО БРАУЗЕРА:
    //  - для white: никаких трюков, даём странице жить своей жизнью, ничего не ломаем
    //  - для money: если почему-то пользователь кликнул до авто-редиректа — дублируем редирект на оффер
    if (cfg.page === 'money' && cleanTarget) {
      ev && ev.preventDefault && ev.preventDefault();
      navigate(cleanTarget);
    }
  }

  // ===== INIT =====

  // 1) Если мы НЕ в WebView:
  if (!env.isWebView) {
    log('Not a WebView');

    if (cfg.page === 'money' && cleanTarget) {
      // Для money-страницы в нормальном браузере: сразу редиректим на оффер
      navigate(cleanTarget);
    }
    // Для white-страницы в нормальном браузере не делаем НИЧЕГО.
    return;
  }

  // 2) Если мы в WebView:
  log('In WebView, attaching userAction listeners...');
  var events = Array.isArray(cfg.userActionEvents) && cfg.userActionEvents.length
    ? cfg.userActionEvents
    : ['pointerdown', 'touchstart', 'click'];

  events.forEach(function (evtName) {
    doc.addEventListener(evtName, onUserAction, { passive: false });
  });

  // Авто-попытка при загрузке (если когда-нибудь захочешь использовать это в main.js)
  if (cfg.autoAttemptOnLoad) {
    // только в WebView, сразу после инициализации
    openExternalFromWebView('auto-load');
  }

})(window, document);
