// intent-logger.js v3 — and UAParser.js v2.0.6
(function () {
  const Logger = {};
  const MAX_ERRORS = 50;
  let errors = [];

  function pushErr(type, args) {
    try {
      errors.push({
        type,
        ts: Date.now(),
        msg: args.map(a => {
          if (a instanceof Error) return a.stack || a.message;
          if (typeof a === 'object') {
            try { return JSON.stringify(a); } catch (_) { return String(a); }
          }
          return String(a);
        }).join(' ')
      });
      if (errors.length > MAX_ERRORS) errors.shift();
    } catch (e) {}
  }

  Logger.getErrors = () => errors.slice();
  Logger.clearErrors = () => { errors = []; };

  // UAParser
  function parseUA() {
    try {
      if (typeof UAParser !== "function") {
        return { error: "UAParser_not_loaded" };
      }

      const parser = new UAParser();
      const info = parser.getResult();  
      return {
        ua: navigator.userAgent || '',
        browser: info.browser || {},
        engine: info.engine || {},
        os: info.os || {},
        device: info.device || {},
        cpu: info.cpu || {},
        isMobile: !!info.device && (info.device.type === "mobile" || info.device.type === "tablet"),
        raw: info
      };
    } catch (e) {
      return { error: "UAParser_failed", msg: String(e) };
    }
  }


  Logger.hookErrors = function (cfg) {
    if (Logger._hooked) return;
    Logger._hooked = true;

    const _ce = console.error, _cw = console.warn, _cl = console.log;
    const shouldCaptureLogs = !!(cfg && cfg.captureLogs);

    console.error = (...a)=>{ pushErr('console_error', a); _ce.apply(console,a); };
    console.warn  = (...a)=>{ pushErr('console_warn', a);  _cw.apply(console,a); };
    console.log   = (...a)=>{ if (shouldCaptureLogs) pushErr('console_log', a); _cl.apply(console,a); };

    window.addEventListener('error', (e)=>{
      pushErr('window_error', [e.message, e.filename, e.lineno, e.colno]);
    });

    window.addEventListener('unhandledrejection', (e)=>{
      pushErr('unhandledrejection', [e.reason]);
    });
  };


  Logger.beacon = async function (cfg, event, extra) {
    try {
      if (!cfg || !cfg.beaconEndpoint) return;

      const parsed = parseUA();

      const payload = Object.assign({
        event,
        ts: Date.now(),
        variant: cfg.variant || cfg.intentScheme || 'default',
        intentTarget: cfg.intentTarget,


        ua: parsed.ua,
        browserName: parsed.browser.name || null,
        browserVersion: parsed.browser.version || null,
        engineName: parsed.engine.name || null,
        osName: parsed.os.name || null,
        osVersion: parsed.os.version || null,
        deviceVendor: parsed.device.vendor || null,
        deviceModel: parsed.device.model || null,
        deviceType: parsed.device.type || null,
        cpuArch: parsed.cpu.architecture || null,
        isMobileDevice: parsed.isMobile,

        lang: navigator.language,
        platform: navigator.platform,
        screen: (screen && screen.width) ? `${screen.width}x${screen.height}` : null,
        devicePixelRatio: window.devicePixelRatio || null,
        timezone: (() => {
          try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
          } catch (e) {
            return null;
          }
        })(),

        uaParserFull: parsed.raw 
      }, extra || {});

      let body;
      try {
        body = JSON.stringify(payload);
      } catch (e) {
        // Handle circular references - remove problematic field
        delete payload.uaParserFull;
        try {
          body = JSON.stringify(payload);
        } catch (e2) {
          return; // Cannot serialize, skip beacon
        }
      }

      if (navigator.sendBeacon) {
        // sendBeacon returns false if the queue is full, fallback to fetch in that case
        if (!navigator.sendBeacon(cfg.beaconEndpoint, body)) {
          fetch(cfg.beaconEndpoint, {
            method: 'POST',
            headers: { 'Content-Type':'application/json' },
            body,
            keepalive: true
          }).catch(() => {});
        }
      } else {
        fetch(cfg.beaconEndpoint, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body,
          keepalive: true
        }).catch(() => {});
      }
    } catch (e) {}
  };


  Logger.trackOutcome = function (cfg, openUrl, reason) {
    const t0 = Date.now();
    let finalized = false;
    let blurAt=null, hiddenAt=null, pagehideAt=null;
    let finalizeTimer = null;

    function finalize(status, why) {
      if (finalized) return;
      finalized = true;
      if (finalizeTimer) clearTimeout(finalizeTimer);

      Logger.beacon(cfg, 'intent_result', {
        reason,
        openUrl,
        status,
        why,
        dt: Date.now() - t0,
        blurAt, hiddenAt, pagehideAt,
        errors: Logger.getErrors()
      });

      cleanup();
    }

    function onBlur() {
      if (!blurAt) blurAt = Date.now();
      if (blurAt - t0 < 2200) finalize('likely_success', 'blur_fast');
    }
    function onVis() {
      if (document.visibilityState === 'hidden' && !hiddenAt) {
        hiddenAt = Date.now();
        if (hiddenAt - t0 < 2200) finalize('likely_success', 'hidden_fast');
      }
    }
    function onHide() {
      if (!pagehideAt) pagehideAt = Date.now();
      if (pagehideAt - t0 < 2200) finalize('likely_success', 'pagehide_fast');
    }

    function cleanup() {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
    }

    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);

    // Allow configurable timeout via cfg.outcomeTimeoutMs, fallback to 3000ms
    const OUTCOME_TIMEOUT = (cfg && cfg.outcomeTimeoutMs) || 3000;
    finalizeTimer = setTimeout(() => finalize('likely_fail', 'timeout_no_events'), OUTCOME_TIMEOUT);
  };

  window.IntentBypassLogger = Logger;
})();
