<?php
require __DIR__ . '/auth.php';

function sumaho_deny()
{
    http_response_code(401);
    header('Content-Type: text/plain; charset=UTF-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo "ログインが必要です\n";
    exit;
}

if (!sumaho_logged_in()) {
    sumaho_deny();
}

$uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '';
$path = parse_url($uri, PHP_URL_PATH);
$path = rawurldecode(is_string($path) ? $path : '');
$base = basename($path);
$map = array(
    'index.html' => array('index.html', 'text/html; charset=UTF-8', true),
    'install.html' => array('install.html', 'text/html; charset=UTF-8', true),
    'app.js' => array('app.js', 'application/javascript; charset=UTF-8', false),
    'styles.css' => array('styles.css', 'text/css; charset=UTF-8', false),
    'sw.js' => array('sw.js', 'application/javascript; charset=UTF-8', false),
    'manifest.json' => array('manifest.json', 'application/json; charset=UTF-8', false),
    'kubiraku.apk' => array('download/kubiraku.apk', 'application/vnd.android.package-archive', false),
);
if (!isset($map[$base])) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    echo "見つかりません\n";
    exit;
}

$rel = $map[$base][0];
$file = __DIR__ . '/' . $rel;
if (!is_file($file)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    echo "見つかりません\n";
    exit;
}

header('Content-Type: ' . $map[$base][1]);
header('X-Content-Type-Options: nosniff');
if ($map[$base][2]) {
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
} else {
    header('Cache-Control: private, no-cache');
}
if ($base === 'kubiraku.apk') {
    header('Content-Disposition: attachment; filename="kubiraku.apk"');
    header('Content-Length: ' . filesize($file));
}
readfile($file);
