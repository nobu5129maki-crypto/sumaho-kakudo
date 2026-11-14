<?php
require __DIR__ . '/auth.php';

if (!sumaho_logged_in()) {
    $target = sumaho_cookie_path();
    if ($target !== '/') {
        $target .= '/';
    }
    header('Location: ' . $target, true, 302);
    header('Cache-Control: no-store');
    exit;
}

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
readfile(__DIR__ . '/install.html');
