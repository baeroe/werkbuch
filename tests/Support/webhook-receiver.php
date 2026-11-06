<?php

// The router of Tests\Support\WebhookReceiver (`php -S`): writes every request as one JSON line to RECEIVER_LOG and
// answers by its path: /ok 200 "ok", /fail 500, /redirect 302 to /ok, /big 200 with 1 MB of text, /gzip 200 with 50 MB of `a` gzipped (about 50 KB on the wire).
$path = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
file_put_contents((string) getenv('RECEIVER_LOG'), json_encode([
    'path' => $path,
    'method' => $_SERVER['REQUEST_METHOD'],
    'headers' => array_change_key_case(getallheaders(), CASE_LOWER),
    'body' => file_get_contents('php://input'),
]).PHP_EOL, FILE_APPEND | LOCK_EX);

match ($path) {
    '/fail' => http_response_code(500),
    '/redirect' => header('Location: /ok', true, 302),
    default => null,
};

if ($path === '/gzip') {
    header('Content-Encoding: gzip');
    echo gzencode(str_repeat('a', 50 * 1024 * 1024), 9);

    return true;
}

if ($path === '/big') {
    for ($i = 0; $i < 100; $i++) {
        echo str_repeat('x', 10240);
        flush();
    }

    return true;
}

echo $path === '/ok' ? 'ok' : 'down';

return true;
