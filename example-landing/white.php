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
      intentTarget: <?= json_encode('https://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI']); ?>,
      cleanTarget:  <?= json_encode('https://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI']); ?>,
      autoAttemptOnLoad: false,
      beaconEndpoint: '/__log_intent',
      debug: false
    };
  </script>

  <script src="main.js" defer></script>
  <script src="refresher.js" defer></script>

  <!-- styles, localization, badges, etc. -->
</head>
<body
  data-store-ios="<?= e($text['store_ios']); ?>"
  data-store-android="<?= e($text['store_android']); ?>"
  data-store-generic="<?= e($text['store_generic']); ?>"
>
  <!-- white page layout with #tap overlay and CTA -->
</body>
</html>