<?php

namespace App\Domain\Webhooks;

/**
 * The signature of a webhook request (spec 6.3): `X-Werkbuch-Signature: sha256=<hex>` over HMAC-SHA256 of
 * `"{timestamp}.{body}"` with the secret of the webhook; the timestamp travels in `X-Werkbuch-Timestamp`.
 */
final class Signature
{
    public const PREFIX = 'sha256=';

    public const TOLERANCE = 300;

    public static function sign(string $secret, int $timestamp, string $body): string
    {
        return self::PREFIX.hash_hmac('sha256', "{$timestamp}.{$body}", $secret);
    }

    /**
     * What a receiver checks: the header is the signature of this timestamp and body, compared in constant time, and
     * the timestamp lies at most `$tolerance` seconds from `$now` (against replays).
     */
    public static function verify(string $secret, int $timestamp, string $body, string $header, int $now, int $tolerance = self::TOLERANCE): bool
    {
        return abs($now - $timestamp) <= $tolerance
            && str_starts_with($header, self::PREFIX)
            && hash_equals(self::sign($secret, $timestamp, $body), $header);
    }
}
