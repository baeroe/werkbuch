<?php

namespace App\Domain\GitHub;

/**
 * The signature of a webhook delivery of GitHub (spec 11.4): `X-Hub-Signature-256` is `sha256=` and the hex HMAC-SHA256
 * of the raw body with the webhook secret of the app, compared in constant time. A missing or malformed header is no match.
 */
final class WebhookSignature
{
    public static function sign(string $secret, string $body): string
    {
        return 'sha256='.hash_hmac('sha256', $body, $secret);
    }

    public static function matches(string $secret, string $body, ?string $header): bool
    {
        return is_string($header) && $secret !== '' && hash_equals(self::sign($secret, $body), $header);
    }
}
