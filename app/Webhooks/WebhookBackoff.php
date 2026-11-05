<?php

namespace App\Webhooks;

use App\Domain\Webhooks\Backoff;
use Spatie\WebhookServer\BackoffStrategy\BackoffStrategy;

/**
 * The pauses between the tries of a delivery for spatie (A365): Backoff::delayAfter of the try that failed.
 */
final class WebhookBackoff implements BackoffStrategy
{
    public function waitInSecondsAfterAttempt(int $attempt): int
    {
        return Backoff::delayAfter($attempt);
    }
}
