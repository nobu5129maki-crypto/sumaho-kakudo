<?php
require __DIR__ . '/auth.php';

if (!sumaho_logged_in()) {
    http_response_code(401);
    header('Content-Type: text/plain; charset=UTF-8');
    header('Cache-Control: no-store');
    echo "ログインが必要です\n";
    exit;
}

$file = __DIR__ . '/download/kubiraku.apk';
if (!is_file($file)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    echo "見つかりません\n";
    exit;
}

header('Content-Type: application/vnd.android.package-archive');
header('Content-Disposition: attachment; filename="kubiraku.apk"');
header('Content-Length: ' . filesize($file));
header('Cache-Control: private, no-cache');
header('X-Content-Type-Options: nosniff');
readfile($file);
