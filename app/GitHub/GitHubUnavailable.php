<?php

namespace App\GitHub;

use RuntimeException;

/**
 * GitHub could not do what werkbuch asked: no app or a repo out of reach (`unreachable`, a 409 for the caller), or the
 * API refused, did not answer or answered nothing usable (`github`, a 503; `status` null without an answer). The message names the path and status, never a body (a body can
 * carry a token or a key).
 */
final class GitHubUnavailable extends RuntimeException
{
    public const UNREACHABLE = 'unreachable';

    public const GITHUB = 'github';

    /** The status of a body GitHub answered that werkbuch cannot use: no network error, no 5xx. */
    public const MALFORMED = 200;

    public function __construct(public readonly string $reason, string $message, public readonly ?int $status = null)
    {
        parent::__construct($message);
    }

    /** Whether it may pass by itself: GitHub did not answer or answered with a 5xx (A511). */
    public function transient(): bool
    {
        return $this->reason === self::GITHUB && ($this->status === null || $this->status >= 500);
    }
}
