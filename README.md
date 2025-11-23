In‑App Intent Opener for TikTok/Facebook WebView
================================================

What this is
- A tiny front‑end library (main.js) that opens your target URL via Android intents or iOS deep links from in‑app WebViews (TikTok, Facebook, etc.).
- A logger (intent-logger.js) that sends lightweight analytics beacons (attempt/result/exception) to a PHP endpoint.
- A PHP collector (intent-log.php) that writes events into MySQL (preferred) or falls back to a file log.

Repository layout
- main.js — core intent logic and user‑gesture handling.
- intent-logger.js — analytics beacons with outcome detection.
- refresher.js — single reload helper for “white” pages only.
- index.php — a demo white page (UI only).
- intent-log.php — PHP collector; inserts into MySQL if configured, otherwise appends to logs/intent-beacon.log.
- db.php — PDO helper (used by intent-log.php).
- mysql/intent_events.sql — MySQL schema for events table.
- ua-parser.js — UA parser used both by main.js and logger (you can replace with your own build).

Requirements
- PHP 7.4+ with pdo_mysql.
- MySQL 5.7+ (JSON columns) or MySQL 8.x.
- Any HTTP server (Nginx/Apache) that can serve static assets and PHP.

Production paths (server filesystem and public URLs)
- PHP (filesystem under your vhost docroot):
  - /app/public/landers/intent-log.php — beacon endpoint
  - /app/public/landers/db.php — PDO helper
  - /app/public/landers/logs/ — writable folder for file logs (fallback)
  - /app/public/landers/mysql/intent_events.sql — DB schema
- JavaScript (public URLs):
  - /landers/ua-parser.js
  - /landers/refresher.js (white page only)
  - /landers/intent-logger.js
  - /landers/main.js

Database setup
1) Create database and run schema:
   - mysql -u USER -p DB_NAME < /app/public/landers/mysql/intent_events.sql
2) Provide environment variables to the PHP worker (FPM/Apache):
   - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS
   - If not set or connection fails, collector falls back to file logs at /app/public/landers/logs/intent-beacon.log
3) Ensure /app/public/landers/logs has write permissions for the web user.

Front‑end integration (public URLs under /landers/)
1) Include libraries in the page head (order matters):
   - UAParser
   - refresher.js (only on white pages)
   - intent-logger.js
   - Your config block (window.IntentBypassConfig)
   - main.js

Money page example (recommended for TikTok/Facebook WebView)

<?php include '/app/public/landers/antihash.php'; ?>
<!-- UAParser -->
<script src="/landers/ua-parser.js"></script>
<!-- Logger -->
<script src="/landers/intent-logger.js"></script>

<!-- Config -->
<script>
  window.IntentBypassConfig = {
    intentTarget: "https://example.com/click?lp=1",
    pageType: "money",                      // white | money

    // Intent scheme and open method
    intentScheme: "dispatcher",             // minimal | fallback | view_browsable | dispatcher
    openMethod: "self",                     // blank | self | href | replace | anchor | two_step | overlay

    // Triggers
    intentSelectors: [],                     // empty = capture full screen
    fullscreenTrigger: true,

    // Attempts and timings
    autoAttemptOnLoad: false,                // keep off in WebViews
    gestureDedupeMs: 400,                    // merge duplicate pointer/touch events
    outcomeTimeoutMs: 3500,                  // outcome window

    // Analytics
    beaconEndpoint: "/landers/intent-log.php",
    variant: "dispatcher_self",
    debug: false,
    captureLogs: false,

    // Optional switches
    forceIntent: false,                      // true disables real-browser guard (always build intent)
    forceWVDispatcher: false                 // true forces dispatcher+self in Android WebView
  };
</script>

<!-- Core script -->
<script defer src="/landers/main.js"></script>

White page example (cover/bridge page)

<!-- UAParser + refresher only on white page -->
<script src="/landers/ua-parser.js"></script>
<script src="/landers/refresher.js"></script>
<script src="/landers/intent-logger.js"></script>
<script>
  window.IntentBypassConfig = {
    intentTarget: window.location.href,
    pageType: "white",
    intentScheme: "minimal",
    openMethod: "href",
    autoAttemptOnLoad: false,
    beaconEndpoint: "/landers/intent-log.php",
    variant: "white_minimal",
    debug: false,
    captureLogs: false
  };
</script>
<script defer src="/landers/main.js"></script>

Config reference
- intentTarget (string, required): final https URL.
- pageType ("white" | "money", default "white"): unlocks triggers and changes default behavior.
- intentScheme ("minimal" | "fallback" | "view_browsable" | "dispatcher"): how the Android intent is built.
- openMethod ("blank" | "self" | "href" | "replace" | "anchor" | "two_step" | "overlay").
- intentSelectors (string[]): CSS selectors to bind user gestures; empty = capture full screen.
- fullscreenTrigger (bool): full-screen capture when no selectors provided.
- autoAttemptOnLoad (bool): do not use inside IABs; requires user interaction.
- gestureDedupeMs (number, ms): merges duplicate touch/click bursts.
- outcomeTimeoutMs (number, ms): time window to decide likely_success/likely_fail.
- beaconEndpoint (string): POST endpoint (/landers/intent-log.php).
- variant (string): free tag for experiments.
- debug, captureLogs (bool): verbose logging and client log capture into errors[] field.
- forceIntent (bool): if true, disables real‑browser guard and always builds intent.
- forceWVDispatcher (bool): if true, forcibly uses dispatcher+self on Android WebView.

Schemes — when to use
- dispatcher: best reliability on Android WebView (TikTok/Facebook). Recommended.
- fallback: adds S.browser_fallback_url; good if device might lack Chrome.
- view_browsable: explicit VIEW+BROWSABLE action; some OEMs prefer it.
- minimal: smallest payload; often gets unwrapped to https inside WebView.

Open methods — quick notes
- self: keeps user activation; most reliable inside WebViews.
- href/replace: navigate current location.
- blank: may lose user activation and be blocked in WebViews — avoid for intents.
- anchor: synthetic anchor click; similar caveats to blank.
- two_step: opens new window then bounces current to https as a fallback.
- overlay: creates full‑screen <a>; we arm it only on weak gestures.

Gesture handling
- We listen on pointerdown (fallback to touchstart/mousedown) and coalesce events by gestureDedupeMs.
- We inspect navigator.userActivation.isActive and event.isTrusted:
  - Strong gesture → open intent immediately.
  - Weak gesture → arm an overlay link; user’s next tap produces a strong gesture without losing traffic.

Beacons & analytics
- intent_attempt: fired before opening; includes environment, scheme/method and gesture fields (userActivationActive, eventIsTrusted, pointerType, gestureStrong).
- intent_result: fired on outcome (blur/hidden/pagehide/timeout); includes dt and errors[] (captured console/rejection events if captureLogs=true).
- intent_exception: if opening routine throws.
- intent_arm_overlay: logged when a weak gesture arms the overlay.
- real_browser_redirect: when we short‑circuit on real browsers (unless forceIntent=true).

Server collector
- intent-log.php first tries MySQL (intent_events) via db.php; if it fails, it appends to logs/intent-beacon.log.
- You can safely run the site without DB — you will still get file logs.

Testing checklist
- Android TikTok/Ultralite IAB: verify dispatcher+self opens external Chrome.
- Ensure only one attempt/result per user gesture (no touchstart+click duplicates).
- Toggle forceIntent to validate behavior in Chrome (should just navigate to https inside Chrome).
- Check DB row appears; stop MySQL and verify fallback to file.

Troubleshooting
- “Cannot read properties of null (reading 'getItem')” on the offer page: that is the target site accessing storage when it’s disabled in IAB; not an issue in our scripts.
- Too many events: increase gestureDedupeMs; ensure you don’t bind both pointerdown and click.
- False positive hidden_fast in TikTok: prefer dispatcher+self and rely on blur/pagehide; outcomeTimeoutMs ≥ 3000ms works well.
- CORS: restrict Access-Control-Allow-Origin in intent-log.php for production.

Security & privacy
- Restrict origins allowed to POST to your collector.
- Keep logs under a non-public path if possible; rotate and redact PII.
- MySQL table stores raw_json for forensics; you can drop/rotate it if not needed.