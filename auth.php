<?php
// 公開フォルダの外にある htpasswd と照合する。パスワードは画面にもログにも出さない。

function sumaho_htpasswd_path()
{
    $override = getenv('SUMAHO_HTPASSWD');
    if (is_string($override) && $override !== '') {
        return $override;
    }
    return '/home/xs519923/sumaho-kakudo.htpasswd';
}

function sumaho_cookie_path()
{
    $script = isset($_SERVER['SCRIPT_NAME']) ? str_replace('\\', '/', (string) $_SERVER['SCRIPT_NAME']) : '';
    $dir = str_replace('\\', '/', dirname($script));
    if ($dir === '/' || $dir === '.' || $dir === '') {
        return '/';
    }
    return rtrim($dir, '/');
}

function sumaho_session_start()
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    ini_set('session.gc_maxlifetime', '2592000');
    session_name('sumahokakudo');
    $path = sumaho_cookie_path();
    session_set_cookie_params(array(
        'lifetime' => 2592000,
        'path' => $path,
        'domain' => '',
        'secure' => false,
        'httponly' => true,
        'samesite' => 'Lax',
    ));
    session_start();
}

function sumaho_logged_in()
{
    sumaho_session_start();
    return isset($_SESSION['sumaho_user']) && is_string($_SESSION['sumaho_user']) && $_SESSION['sumaho_user'] !== '';
}

function sumaho_apr1_64($value, $count)
{
    $itoa = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    $out = '';
    while ($count > 0) {
        $out .= $itoa[$value & 0x3f];
        $value >>= 6;
        $count -= 1;
    }
    return $out;
}

function sumaho_apr1($password, $salt)
{
    $password = (string) $password;
    $salt = substr((string) $salt, 0, 8);
    $magic = '$apr1$';
    $len = strlen($password);
    $mixin = md5($password . $salt . $password, true);
    $ctx = $password . $magic . $salt;
    for ($i = $len; $i > 0; $i -= 16) {
        $ctx .= substr($mixin, 0, min(16, $i));
    }
    for ($i = $len; $i > 0; $i >>= 1) {
        $ctx .= ($i & 1) ? "\x00" : $password[0];
    }
    $final = md5($ctx, true);
    for ($i = 0; $i < 1000; $i++) {
        $next = '';
        $next .= ($i & 1) ? $password : $final;
        if ($i % 3) {
            $next .= $salt;
        }
        if ($i % 7) {
            $next .= $password;
        }
        $next .= ($i & 1) ? $final : $password;
        $final = md5($next, true);
    }
    $chars = array_values(unpack('C*', $final));
    $encoded = sumaho_apr1_64(($chars[0] << 16) | ($chars[6] << 8) | $chars[12], 4)
        . sumaho_apr1_64(($chars[1] << 16) | ($chars[7] << 8) | $chars[13], 4)
        . sumaho_apr1_64(($chars[2] << 16) | ($chars[8] << 8) | $chars[14], 4)
        . sumaho_apr1_64(($chars[3] << 16) | ($chars[9] << 8) | $chars[15], 4)
        . sumaho_apr1_64(($chars[4] << 16) | ($chars[10] << 8) | $chars[5], 4)
        . sumaho_apr1_64($chars[11], 2);
    return $magic . $salt . '$' . $encoded;
}

function sumaho_password_matches($password, $hash)
{
    if (strncmp($hash, '$apr1$', 6) !== 0) {
        return false;
    }
    $rest = substr($hash, 6);
    $salt = strstr($rest, '$', true);
    if (!is_string($salt) || $salt === '') {
        return false;
    }
    $calc = sumaho_apr1($password, $salt);
    return hash_equals($hash, $calc);
}

function sumaho_check_login($id, $password)
{
    $id = (string) $id;
    $password = (string) $password;
    if ($id === '' || $password === '') {
        return false;
    }
    $path = sumaho_htpasswd_path();
    if (!is_file($path) || !is_readable($path)) {
        return false;
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if (!is_array($lines)) {
        return false;
    }
    foreach ($lines as $line) {
        $parts = explode(':', $line, 2);
        if (count($parts) !== 2) {
            continue;
        }
        if (!hash_equals($parts[0], $id)) {
            continue;
        }
        return sumaho_password_matches($password, $parts[1]);
    }
    return false;
}
