<?php
/**
 * AntiHash bootstrap (PHP edition)
 *
 * Include this file once (ideally inside <head>) to generate a per-request anti-hash token,
 * decorate meta/link tags with that token, and expose it to client-side scripts such as refresher.js.
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

$antiHashConfig = isset($antiHashConfig) && is_array($antiHashConfig) ? $antiHashConfig : [];
$antiHashToken = anti_hash_generate_token($antiHashConfig);

$metaConfig = isset($antiHashConfig['meta']) && is_array($antiHashConfig['meta']) ? $antiHashConfig['meta'] : [];
$currentUrl = anti_hash_current_url();
$canonicalBase = isset($antiHashConfig['canonical']) ? $antiHashConfig['canonical'] : $currentUrl;
$ogUrlBase = isset($antiHashConfig['og:url']) ? $antiHashConfig['og:url'] : $canonicalBase;
$twitterUrlBase = isset($antiHashConfig['twitter:url']) ? $antiHashConfig['twitter:url'] : $canonicalBase;
$canonicalHref = anti_hash_add_query_param($canonicalBase, 'antiHash', $antiHashToken);
$ogUrl = anti_hash_add_query_param($ogUrlBase, 'antiHash', $antiHashToken);
$twitterUrl = anti_hash_add_query_param($twitterUrlBase, 'antiHash', $antiHashToken);

$metaTargets = [
    ['attr' => 'name', 'key' => 'description'],
    ['attr' => 'property', 'key' => 'og:description'],
    ['attr' => 'name', 'key' => 'twitter:description'],
];

?>
<meta name="anti-hash-token" content="<?php echo anti_hash_escape_attr($antiHashToken); ?>">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate, max-age=0">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<meta http-equiv="x-dns-prefetch-control" content="off">
<?php
$antiHashDomNoiseId = 'anti-hash-dom-' . substr(hash('sha1', $antiHashToken . microtime(true)), 0, 12);
$antiHashDomNoiseAttr = 'data-ah-' . substr(hash('crc32b', $antiHashToken . random_int(0, PHP_INT_MAX)), 0, 8);
?>
<meta name="anti-hash-token" content="<?php echo anti_hash_escape_attr($antiHashToken); ?>">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate, max-age=0">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<meta http-equiv="x-dns-prefetch-control" content="off">
<meta name="<?php echo anti_hash_escape_attr('anti-hash-' . substr($antiHashDomNoiseId, -6)); ?>" content="<?php echo anti_hash_escape_attr($antiHashToken); ?>">
<?php echo "\n<!-- anti-hash:" . anti_hash_escape_html($antiHashToken) . ':' . anti_hash_escape_html((string) microtime(true)) . " -->\n"; ?>
<?php foreach ($metaTargets as $metaTarget):
    $key = $metaTarget['key'];
    $baseContent = isset($metaConfig[$key]) ? $metaConfig[$key] : '';
    $content = anti_hash_append_token($baseContent, $antiHashToken);
    if ($content === '') {
        continue;
    }
    ?>
    <meta <?php echo $metaTarget['attr']; ?>="<?php echo anti_hash_escape_attr($key); ?>" content="<?php echo anti_hash_escape_attr($content); ?>">
<?php endforeach; ?>
<?php if ($canonicalHref): ?>
<link rel="canonical" href="<?php echo anti_hash_escape_attr($canonicalHref); ?>">
<?php endif; ?>
<?php if ($ogUrl): ?>
<meta property="og:url" content="<?php echo anti_hash_escape_attr($ogUrl); ?>">
<?php endif; ?>
<?php if ($twitterUrl): ?>
<meta name="twitter:url" content="<?php echo anti_hash_escape_attr($twitterUrl); ?>">
<?php endif; ?>
<div id="tt-anti-hash-marker" data-token="<?php echo anti_hash_escape_attr($antiHashToken); ?>" style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;"><?php echo anti_hash_escape_html($antiHashToken); ?></div>
<div id="<?php echo anti_hash_escape_attr($antiHashDomNoiseId); ?>" <?php echo anti_hash_escape_attr($antiHashDomNoiseAttr); ?>="<?php echo anti_hash_escape_attr(substr($antiHashToken, 0, 16)); ?>" style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;opacity:0;"><?php echo anti_hash_escape_html(strrev($antiHashToken)); ?></div>
<script>
  (function (win, doc, token) {
    win.__antiHashToken = token;
    win.getAntiHashToken = win.getAntiHashToken || function () { return token; };
    if (doc && doc.documentElement) {
      doc.documentElement.setAttribute('data-anti-hash', token);
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
        $_SERVER['REMOTE_ADDR'] ?? '',
        $_SERVER['HTTP_USER_AGENT'] ?? '',
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
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ||
        (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443);
    $scheme = $isHttps ? 'https://' : 'http://';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $uri = $_SERVER['REQUEST_URI'] ?? '/';

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
