<?php

/**
 * Checks a request from werkbuch: `X-Werkbuch-Signature` must be `sha256=` and the hex HMAC-SHA256 of
 * "<X-Werkbuch-Timestamp>.<body>" with the secret of the webhook, and the timestamp at most 300 seconds away from now
 * (against replays). Pass the body exactly as it arrived (`file_get_contents('php://input')`), before json_decode().
 * A missing or malformed header is no valid signature: the function answers false, it never throws.
 *
 * @param  string  $secret  the secret of the webhook
 * @param  int|string|null  $timestamp  the header X-Werkbuch-Timestamp (Unix seconds), null when it is missing
 * @param  string  $body  the raw body
 * @param  string|null  $signatureHeader  the header X-Werkbuch-Signature, null when it is missing
 * @param  int|null  $now  Unix seconds, now by default
 */
function verifyWerkbuchSignature(string $secret, int|string|null $timestamp, string $body, ?string $signatureHeader, ?int $now = null): bool
{
    $sent = (string) $timestamp;
    if ($signatureHeader === null || preg_match('/\A\d{1,10}\z/', $sent) !== 1 || abs(($now ?? time()) - (int) $sent) > 300) {
        return false;
    }

    $expected = 'sha256='.hash_hmac('sha256', $sent.'.'.$body, $secret);

    // compared in constant time
    return hash_equals($expected, $signatureHeader);
}
