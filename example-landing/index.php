<!DOCTYPE html>
<html lang="en">
<head>
  <?php include __DIR__ . '/antihash.php'; ?>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Offer</title>

  <script>
    window.IntentBypassConfig = {
      intentTarget: '{offer}',  // Keitaro / final URL
      cleanTarget:  '{offer}',
      autoAttemptOnLoad: false,
      beaconEndpoint: '/__log_intent',
      debug: false
    };
  </script>
  <script src="main.js" defer></script>
</head>
<body>
  <!-- your money page layout, CTA buttons, etc. -->
</body>
</html>