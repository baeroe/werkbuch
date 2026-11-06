<?php

/**
 * Checks a request from werkbuch: `X-Werkbuch-Signature` must be `sha256=` and the hex HMAC-SHA256 of
 * "<X-Werkbuch-Timestamp>.<body>" with the secret of the webhook, and the timestamp at most 300 seconds away from now
 * (against replays). Pass the body exactly as it arrived (`file_get_contents('php://input')`), before json_decode().
 *
 * @param  string  $secret  the secret of the webhook
 * @param  int|string  $timestamp  the header X-Werkbuch-Timestamp (Unix seconds)
 * @param  string  $body  the raw body
 * @param  string  $signatureHeader  the header X-Werkbuch-Signature
 * @param  int|null  $now  Unix seconds, now by default
 */
function verifyWerkbuchSignature(string $secret, int|string $timestamp, string $body, string $signatureHeader, ?int $now = null): bool
{
    $sent = (string) $timestamp;
    if (preg_match('/^\d{1,10}$/', $sent) !== 1 || abs(($now ?? time()) - (int) $sent) > 300) {
        return false;
    }

    $expected = 'sha256='.hash_hmac('sha256', $sent.'.'.$body, $secret);

    // compared in constant time
    return hash_equals($expected, $signatureHeader);
}
