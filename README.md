TikTok Intent Flow
==================

Two-step funnel tuned for TikTok in-app WebView: a **white page** (neutral pre-lander) and a **money page** (offer / Keitaro lander). The flow forces a clean jump from the WebView into the system browser (Chrome / Safari) while defeating TikTok’s aggressive preloading and caching.

Contents
--------
1. [Architecture](#architecture)
2. [Components](#components)
3. [Configuration](#configuration)
4. [Integration Recipes](#integration-recipes)
5. [Operational Notes](#operational-notes)

Architecture
------------
- **White page**: compliant copy + once-per-session refresh to kill stale snapshots; still triggers the external-browser intent when users interact.
- **Money page**: pure conversion lander; handles the same intent logic without the refresher.
- **Intent strategy**: only fire navigation inside real user gestures. Android opens `intent://` deep links to Chrome, iOS opens `x-safari-https://…`, everything else falls back to a clean HTTPS URL.

Components
----------
### `antihash.php`
- Injected into both pages to append a tiny, unique token (DOM/meta) so TikTok cannot re-use preloaded caches.
- Include it at the very top of `<head>`:

```php
<head>
  <?php include __DIR__ . '/antihash.php'; ?>
  …
</head>
```

### `main.js` or an alternate file main2.js (no auto-intent; only manual click)
Primary intent logic used everywhere.

Responsibilities:
- Reads `window.IntentBypassConfig` that you define inline.
- Detects platform via lightweight `navigator.userAgent` regex (no UA Parser dependency).
- Inside user gestures (`click`, `touchstart`, etc.) decides which target to open:
  - Android Chrome → `intent://` URL to launch Chrome directly.
  - iOS → `x-safari-https://` URL to force Safari.
  - Other → `cleanTarget` HTTPS fallback.
- Optional beacon endpoint for logging intent attempts.

Attach it with your config:

```html
<script>
  window.IntentBypassConfig = {
    intentTarget: '{offer}',          // real offer URL, substituted server-side
    cleanTarget:  '{offer}',          // HTTPS fallback
    autoAttemptOnLoad: false,         // gestures only to avoid popup blocking
    beaconEndpoint: '/__log_intent',  // optional
    debug: false
  };
</script>
<script src="/main.js" defer></script>
```

`main.js` listens on your CTA elements and calls `window.open`/`location` inside those gesture handlers to keep Chrome/WebView happy.

### `refresher.js`
- Used **only** on the white page to force a single reload per tab session.
- Stores a `__intentRefreshSession` flag in `sessionStorage`. If absent, it sets the flag, appends `_r=<timestamp>` to the URL, and reloads—busting preloaded snapshots. Subsequent visits in the same tab do nothing.
- No configs, no intent logic; it silently executes once.

Configuration
-------------
Key values you must set per page:

| Field | Description |
| --- | --- |
| `intentTarget` | Final offer / Keitaro URL; used for `intent://` / `x-safari` jumps. |
| `cleanTarget`  | Plain HTTPS fallback if intents are blocked or unsupported. |
| `autoAttemptOnLoad` | Keep `false` so navigation only fires from gestures. |
| `beaconEndpoint` | Optional URL for logging (POST/GET). |
| `debug` | Enables console logging when diagnosing flows. |

Integration Recipes
-------------------
### Money Page (Offer / Keitaro Lander)
Include `antihash.php` + `main.js`.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <?php include __DIR__ . '/antihash.php'; ?>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Offer</title>

<script>
  window.IntentBypassConfig = {
    page: 'money',
    intentTarget: window.location.href,     
    cleanTarget:  '{offer_link}',
    autoAttemptOnLoad: true,  
    beaconEndpoint: '/__log_intent',
    debug: false
  };
</script>
  <script src="/main.js" defer></script>
</head>
<body>
  <!-- Money page layout, CTA buttons, tracking pixels, etc. -->
</body>
</html>
```

### White Page (Pre-lander)
Include `antihash.php`, `main.js`, and `refresher.js`.

```html
<!DOCTYPE html>
<html lang="<?= e($lang); ?>" dir="<?= e($dir); ?>">
<head>
  <?php include __DIR__ . '/antihash.php'; ?>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <meta name="robots" content="noindex,nofollow" />
  <meta name="x-offer" content="#">
  <title><?= e($text['meta_title']); ?></title>

<script>
  window.IntentBypassConfig = {
    // page не указываем → считается white
    intentTarget: window.location.href,
    // cleanTarget можно не задавать
    autoAttemptOnLoad: true,          
    beaconEndpoint: '/__log_intent', 
    debug: false
  };
</script>

  <script src="/main.js" defer></script>
  <script src="/refresher.js" defer></script>
  <!-- styles, localization, badges, etc. -->
</head>
<body
  data-store-ios="<?= e($text['store_ios']); ?>"
  data-store-android="<?= e($text['store_android']); ?>"
  data-store-generic="<?= e($text['store_generic']); ?>"
>
  <!-- Neutral layout with #tap overlay / CTA that calls main.js handlers -->
</body>
</html>
```

Operational Notes
-----------------
- `ua-parser.js` is deprecated—delete it from deployments; `main.js` contains all required UA checks.
- Always bind navigation to actual user gestures to avoid Chrome/WebView popup blockers.
- If routing TikTok traffic through Keitaro (money → white → money), keep streams consistent so `{offer}` / `{offer_url}` resolve to the correct downstream URL on both pages.
- `refresher.js` should live exclusively on the white page; the money page must never refresh automatically.
- Monitor beacon logs (if enabled) to verify that intents fire when users tap and to spot platforms that may require fallback tweaks.
