<?php

namespace App\Domain\Webhooks;

use InvalidArgumentException;

/**
 * When a delivery is tried again (A365): eight tries, try n about `OFFSETS[n - 1]` seconds after the first, the last
 * one 24 hours after it. The queue measures each pause from the failure, so the real times drift by the time a try
 * and the queue take.
 */
final class Backoff
{
    public const TRIES = 8;

    public const OFFSETS = [0, 60, 360, 2160, 9360, 30960, 74160, 86400];

    /**
     * The pause in seconds after the failed try `$attempt` (1 … 7) before the next one.
     */
    public static function delayAfter(int $attempt): int
    {
        if ($attempt < 1 || $attempt >= self::TRIES) {
            throw new InvalidArgumentException("No try follows try {$attempt}.");
        }

        return self::OFFSETS[$attempt] - self::OFFSETS[$attempt - 1];
    }
}
