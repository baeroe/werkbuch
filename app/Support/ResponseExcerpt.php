<?php

namespace App\Support;

/**
 * What the log keeps of the answer of a receiver (A375): at most `MAX_BYTES` bytes, cut where a character begins
 * (`mb_strcut`); an answer that is no UTF-8 is made valid first (`mb_scrub`), so the column always holds text.
 */
final class ResponseExcerpt
{
    public const MAX_BYTES = 2048;

    public static function of(?string $body): ?string
    {
        if ($body === null || $body === '') {
            return null;
        }

        return mb_strcut(mb_scrub(substr($body, 0, self::MAX_BYTES * 2), 'UTF-8'), 0, self::MAX_BYTES, 'UTF-8');
    }
}
