<?php
require __DIR__ . '/auth.php';
sumaho_session_start();

if (empty($_SESSION['csrf']) || !is_string($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}

$error = '';
$postedId = '';
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $postedId = isset($_POST['login_id']) ? trim((string) $_POST['login_id']) : '';
    $postedPassword = isset($_POST['password']) ? (string) $_POST['password'] : '';
    $postedToken = isset($_POST['csrf']) ? (string) $_POST['csrf'] : '';
    $tokenOk = is_string($_SESSION['csrf']) && hash_equals($_SESSION['csrf'], $postedToken);
    if ($tokenOk && sumaho_check_login($postedId, $postedPassword)) {
        session_regenerate_id(true);
        $_SESSION['sumaho_user'] = $postedId;
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
        $target = sumaho_cookie_path();
        if ($target !== '/') {
            $target .= '/';
        }
        header('Location: ' . $target, true, 303);
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        exit;
    }
    $error = 'IDまたはパスワードが違います';
}

if (sumaho_logged_in()) {
    header('Content-Type: text/html; charset=UTF-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
    header('X-Content-Type-Options: nosniff');
    readfile(__DIR__ . '/index.html');
    exit;
}

header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');
header('X-Content-Type-Options: nosniff');
http_response_code(200);
?>
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#f3efe7">
    <title>ログイン | 首らく</title>
    <link rel="icon" href="icon-192.png" type="image/png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            font-family: "Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif;
            color: #1e2430;
            background:
                radial-gradient(1000px 480px at 0% -10%, #d9efe4, transparent 55%),
                radial-gradient(800px 420px at 100% 0%, #f6e3cf, transparent 50%),
                #f3efe7;
        }
        main { max-width: 420px; margin: 0 auto; padding: 32px 16px 48px; }
        header { text-align: center; }
        img { width: 72px; height: 72px; border-radius: 18px; }
        h1 { margin: 10px 0 0; color: #2f6d56; font-size: 1.5rem; }
        .lead { margin: 8px 0 0; color: #4a524b; }
        form {
            margin-top: 22px;
            background: #fffdf9;
            border: 1px solid rgba(30, 36, 48, 0.08);
            border-radius: 24px;
            padding: 20px;
            box-shadow: 0 12px 40px rgba(60, 48, 30, 0.08);
        }
        label { display: block; font-size: 0.85rem; font-weight: 700; color: #2f6d56; margin-bottom: 6px; }
        .field { margin-bottom: 14px; }
        input {
            width: 100%;
            border: 1px solid rgba(30, 36, 48, 0.14);
            background: #fff;
            border-radius: 12px;
            padding: 12px 14px;
            font: inherit;
        }
        .password-row { display: flex; gap: 8px; }
        .password-row input { min-width: 0; }
        button, .toggle {
            font: inherit;
            cursor: pointer;
        }
        .toggle {
            flex: 0 0 auto;
            border-radius: 12px;
            border: 1px solid #2f6d56;
            background: #fff;
            color: #2f6d56;
            padding: 0 14px;
            font-weight: 700;
        }
        .submit {
            width: 100%;
            border: none;
            border-radius: 14px;
            background: #2f6d56;
            color: #fff;
            font-weight: 700;
            padding: 14px;
        }
        .error {
            margin: 0 0 14px;
            padding: 10px 12px;
            border-radius: 12px;
            background: #fde4dc;
            color: #c4543a;
            font-size: 0.9rem;
        }
        [hidden] { display: none !important; }
    </style>
</head>
<body>
    <main>
        <header>
            <img src="icon-192.png" width="72" height="72" alt="">
            <h1>首らく</h1>
            <p class="lead">入るには ID とパスワードが必要です</p>
        </header>
        <form method="post" action="" autocomplete="off">
            <input type="hidden" name="csrf" value="<?php echo htmlspecialchars($_SESSION['csrf'], ENT_QUOTES, 'UTF-8'); ?>">
            <p id="loginError" class="error" role="alert"<?php echo $error === '' ? ' hidden' : ''; ?>><?php echo htmlspecialchars($error, ENT_QUOTES, 'UTF-8'); ?></p>
            <div class="field">
                <label for="login_id">ID</label>
                <input id="login_id" name="login_id" type="text" inputmode="text" autocomplete="username" required maxlength="64" value="<?php echo htmlspecialchars($postedId, ENT_QUOTES, 'UTF-8'); ?>">
            </div>
            <div class="field">
                <label for="password">パスワード</label>
                <div class="password-row">
                    <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="128">
                    <button type="button" class="toggle" id="togglePassword" aria-controls="password" aria-pressed="false">表示</button>
                </div>
            </div>
            <button type="submit" class="submit">入る</button>
        </form>
    </main>
    <script>
        var idKey = 'sumaho_kakudo_login_id';
        var passwordKey = 'sumaho_kakudo_login_password';
        var form = document.querySelector('form');
        var idInput = document.getElementById('login_id');
        var passwordInput = document.getElementById('password');
        var errorBox = document.getElementById('loginError');

        document.getElementById('togglePassword').addEventListener('click', function () {
            var showing = passwordInput.type === 'text';
            passwordInput.type = showing ? 'password' : 'text';
            this.textContent = showing ? '表示' : '隠す';
            this.setAttribute('aria-pressed', showing ? 'false' : 'true');
        });

        form.addEventListener('submit', function () {
            try {
                sessionStorage.setItem('sumaho_kakudo_pending_id', idInput.value.trim());
                sessionStorage.setItem('sumaho_kakudo_pending_password', passwordInput.value);
            } catch (err) {}
        });

        try {
            var failed = errorBox && !errorBox.hasAttribute('hidden') && errorBox.textContent;
            if (failed) {
                localStorage.removeItem(passwordKey);
                sessionStorage.removeItem('sumaho_kakudo_pending_id');
                sessionStorage.removeItem('sumaho_kakudo_pending_password');
            }
            var savedId = localStorage.getItem(idKey) || '';
            var savedPassword = localStorage.getItem(passwordKey) || '';
            if (!failed && savedId && savedPassword) {
                idInput.value = savedId;
                passwordInput.value = savedPassword;
                form.submit();
            } else if (savedId && !idInput.value) {
                idInput.value = savedId;
            }
        } catch (err) {}
    </script>
</body>
</html>
