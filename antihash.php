<?php
/**
 * AntiHash bootstrap (PHP edition)
 *
 * Include this file once (ideally inside <head>) to generate a per-request anti-hash token,
 * decorate meta tags with that token, and expose it to client-side scripts.
 *
 * Optional overrides can be supplied through $antiHashConfig before including this file:
 * $antiHashConfig = [
 *   'token'      => 'precomputed-token',
 *   'canonical'  => 'https://example.com/landing',
 *   'meta'       => ['description' => 'My desc'],
 *   'og:url'     => 'https://example.com/landing',
 *   'twitter:url'=> 'https://example.com/landing'
 * ];
 */

if (defined('ANTI_HASH_BOOTSTRAPPED')) {
    return;
}
define('ANTI_HASH_BOOTSTRAPPED', true);

// --- No-cache headers ---
$noCacheHeaders = [
    'Cache-Control: no-cache, no-store, must-revalidate, max-age=0',
    'Pragma: no-cache',
    'Expires: 0',
    'Surrogate-Control: no-store',
];
if (!headers_sent()) {
    foreach ($noCacheHeaders as $headerLine) {
        header($headerLine, true);
    }
}

// --- Config & token ---
$antiHashConfig = isset($antiHashConfig) && is_array($antiHashConfig) ? $antiHashConfig : [];
$antiHashToken  = anti_hash_generate_token($antiHashConfig);

$metaConfig = isset($antiHashConfig['meta']) && is_array($antiHashConfig['meta']) ? $antiHashConfig['meta'] : [];

// Эти переменные больше не используются для генерации <link rel="canonical"> и URL-мета
// но оставляем вычисление на случай, если понадобится дальше на PHP-стороне.
$currentUrl     = anti_hash_current_url();
$canonicalBase  = isset($antiHashConfig['canonical'])   ? $antiHashConfig['canonical']   : $currentUrl;
$ogUrlBase      = isset($antiHashConfig['og:url'])      ? $antiHashConfig['og:url']      : $canonicalBase;
$twitterUrlBase = isset($antiHashConfig['twitter:url']) ? $antiHashConfig['twitter:url'] : $canonicalBase;

$metaTargets = [
    ['attr' => 'name',     'key' => 'description'],
    ['attr' => 'property', 'key' => 'og:description'],
    ['attr' => 'name',     'key' => 'twitter:description'],
];
?>
<meta name="anti-hash-token" content="<?php echo anti_hash_escape_attr($antiHashToken); ?>">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate, max-age=0">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<meta http-equiv="x-dns-prefetch-control" content="off">
<?php
$antiHashDomNoiseId   = 'anti-hash-dom-' . substr(hash('sha1', $antiHashToken . microtime(true)), 0, 12);
$antiHashDomNoiseAttr = 'data-ah-' . substr(hash('crc32b', $antiHashToken . random_int(0, PHP_INT_MAX)), 0, 8);
?>
<meta name="<?php echo anti_hash_escape_attr('anti-hash-' . substr($antiHashDomNoiseId, -6)); ?>"
      content="<?php echo anti_hash_escape_attr($antiHashToken); ?>">
<?php
echo "\n<!-- anti-hash:" . anti_hash_escape_html($antiHashToken) . ':' . anti_hash_escape_html((string) microtime(true)) . " -->\n";

// Описательные меты (description / og:description / twitter:description) с токеном
foreach ($metaTargets as $metaTarget):
    $key         = $metaTarget['key'];
    $baseContent = isset($metaConfig[$key]) ? $metaConfig[$key] : '';
    $content     = anti_hash_append_token($baseContent, $antiHashToken);
    if ($content === '') {
        continue;
    }
    ?>
    <meta <?php echo $metaTarget['attr']; ?>="<?php echo anti_hash_escape_attr($key); ?>"
          content="<?php echo anti_hash_escape_attr($content); ?>">
<?php endforeach; ?>

<?php // БОЛЬШЕ НЕ генерируем canonical/og:url/twitter:url на стороне PHP ?>

<div id="tt-anti-hash-marker"
     data-token="<?php echo anti_hash_escape_attr($antiHashToken); ?>"
     style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;">
    <?php echo anti_hash_escape_html($antiHashToken); ?>
</div>
<div id="<?php echo anti_hash_escape_attr($antiHashDomNoiseId); ?>"
     <?php echo anti_hash_escape_attr($antiHashDomNoiseAttr); ?>="<?php echo anti_hash_escape_attr(substr($antiHashToken, 0, 16)); ?>"
     style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;opacity:0;">
    <?php echo anti_hash_escape_html(strrev($antiHashToken)); ?>
</div>

<script>
  (function (win, doc, token) {
    // Экспорт токена в window
    win.__antiHashToken   = token;
    win.getAntiHashToken  = win.getAntiHashToken || function () { return token; };
    if (doc && doc.documentElement) {
      doc.documentElement.setAttribute('data-anti-hash', token);
    }

    // Дальше — ЧИСТО КЛИЕНТСКОЕ построение URL с antiHash и
    // canonical / og:url / twitter:url на основе window.location.href
    try {
      var locHref = win.location && win.location.href ? String(win.location.href) : '';
      if (!locHref) return;

      var url = new URL(locHref);
      // добавляем / обновляем параметр antiHash в QS
      url.searchParams.set('antiHash', token);
      var finalHref = url.toString();

      var head = doc.head || doc.getElementsByTagName('head')[0];
      if (!head) return;

      // <link rel="canonical">
      var canonical = doc.querySelector('link[rel="canonical"]');
      if (!canonical) {
        canonical = doc.createElement('link');
        canonical.setAttribute('rel', 'canonical');
        head.appendChild(canonical);
      }
      canonical.setAttribute('href', finalHref);

      // <meta property="og:url">
      var og = doc.querySelector('meta[property="og:url"]');
      if (!og) {
        og = doc.createElement('meta');
        og.setAttribute('property', 'og:url');
        head.appendChild(og);
      }
      og.setAttribute('content', finalHref);

      // <meta name="twitter:url">
      var tw = doc.querySelector('meta[name="twitter:url"]');
      if (!tw) {
        tw = doc.createElement('meta');
        tw.setAttribute('name', 'twitter:url');
        head.appendChild(tw);
      }
      tw.setAttribute('content', finalHref);

    } catch (e) {
      // тихо глотаем — это чисто вспомогательная логика для уникализации
      // console && console.warn && console.warn('[anti-hash] URL meta error:', e);
    }
  })(window, document, <?php echo json_encode($antiHashToken); ?>);
</script>

<?php

/**
 * Generate the anti-hash token or reuse the provided one.
 */
function anti_hash_generate_token(array $config)
{
    if (!empty($config['token']) && is_string($config['token'])) {
        return substr(preg_replace('/[^a-f0-9]/i', '', $config['token']), 0, 64);
    }

    $entropy = [
        microtime(true),
        $_SERVER['REMOTE_ADDR']      ?? '',
        $_SERVER['HTTP_USER_AGENT']  ?? '',
        session_id(),
        uniqid('', true),
    ];

    try {
        $entropy[] = bin2hex(random_bytes(32));
    } catch (Exception $e) {
        $entropy[] = md5(mt_rand());
    }

    return substr(hash('sha256', implode('|', $entropy)), 0, 32);
}

/**
 * Append token (if not already present) to string.
 */
function anti_hash_append_token($value, $token)
{
    $value = (string)$value;
    if ($value === '') {
        return $token;
    }
    if (strpos($value, $token) !== false) {
        return $value;
    }
    return trim($value . ' ' . $token);
}

/**
 * Append or override a query parameter within a URL.
 */
function anti_hash_add_query_param($url, $key, $value)
{
    if (!$url) {
        return '';
    }
    $parts = parse_url($url);
    if ($parts === false) {
        return '';
    }
    $query = [];
    if (!empty($parts['query'])) {
        parse_str($parts['query'], $query);
    }
    $query[$key] = $value;
    $parts['query'] = http_build_query($query);

    return anti_hash_build_url($parts);
}

/**
 * Build a URL string from parse_url parts.
 */
function anti_hash_build_url(array $parts)
{
    $scheme   = isset($parts['scheme']) ? $parts['scheme'] . '://' : '';
    $host     = $parts['host'] ?? '';
    $port     = isset($parts['port']) ? ':' . $parts['port'] : '';
    $user     = $parts['user'] ?? '';
    $pass     = isset($parts['pass']) ? ':' . $parts['pass']  : '';
    $pass     = ($user || $pass) ? $pass . '@' : '';
    $path     = $parts['path'] ?? '';
    $query    = isset($parts['query']) && $parts['query'] !== '' ? '?' . $parts['query'] : '';
    $fragment = isset($parts['fragment']) ? '#' . $parts['fragment'] : '';

    return $scheme . $user . $pass . $host . $port . $path . $query . $fragment;
}

/**
 * Build the current absolute URL, best effort.
 */
function anti_hash_current_url()
{
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443);
    $scheme = $isHttps ? 'https://' : 'http://';
    $host   = $_SERVER['HTTP_HOST']    ?? 'localhost';
    $uri    = $_SERVER['REQUEST_URI']  ?? '/';

    return $scheme . $host . $uri;
}

function anti_hash_escape_attr($value)
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function anti_hash_escape_html($value)
{
    return htmlspecialchars($value, ENT_NOQUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
