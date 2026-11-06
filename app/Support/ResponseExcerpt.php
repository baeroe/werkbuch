<?php

namespace App\Support;

/**
 * What the log keeps of the answer of a receiver (A375): at most `MAX_BYTES` bytes, cut where a character begins
 * (`mb_strcut`); an answer that is no UTF-8 is made valid first (`mb_scrub`), so the column always holds text. A packed
 * answer (a `Content-Encoding` other than `identity`: the job never unpacks, K4) is named by its encoding and size,
 * `(gzip, 50914 bytes)`, instead of keeping its bytes (T8-M1).
 */
final class ResponseExcerpt
{
    public const MAX_BYTES = 2048;

    /** The most of an encoding name the placeholder keeps. */
    public const ENCODING_MAX = 30;

    public static function of(?string $body, ?string $encoding = null): ?string
    {
        if ($body === null || $body === '') {
            return null;
        }

        $encoding = strtolower(trim((string) $encoding));
        if ($encoding !== '' && $encoding !== 'identity') {
            $name = substr((string) preg_replace('/[^a-z0-9._-]/', '', $encoding), 0, self::ENCODING_MAX);

            return '('.($name === '' ? 'unknown' : $name).', '.strlen($body).' bytes)';
        }

        return mb_strcut(mb_scrub(substr($body, 0, self::MAX_BYTES * 2), 'UTF-8'), 0, self::MAX_BYTES, 'UTF-8');
    }
}
