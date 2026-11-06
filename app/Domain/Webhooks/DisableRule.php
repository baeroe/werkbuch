<?php

namespace App\Domain\Webhooks;

use DateTimeImmutable;

/**
 * When a failing webhook goes off (A366): a failed try at least 24 hours after the first failure since the last
 * success. Measured in real time between two instants, so the day the clocks change counts its real hours.
 */
final class DisableRule
{
    public const AFTER_SECONDS = 86400;

    public static function disables(?DateTimeImmutable $failingSince, DateTimeImmutable $now): bool
    {
        if ($failingSince === null) {
            return false;
        }

        $seconds = $now->getTimestamp() - $failingSince->getTimestamp();
        $micros = (int) $now->format('u') - (int) $failingSince->format('u');

        return $seconds > self::AFTER_SECONDS || ($seconds === self::AFTER_SECONDS && $micros >= 0);
    }
}
