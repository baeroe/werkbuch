<?php

namespace App\GitHub;

use RuntimeException;

/**
 * GitHub could not do what werkbuch asked: no app or a repo out of reach (`unreachable`, a 409 for the caller), or the
 * API refused or did not answer (`github`, a 503). The message names the path and status, never a body (a body can
 * carry a token or a key).
 */
final class GitHubUnavailable extends RuntimeException
{
    public const UNREACHABLE = 'unreachable';

    public const GITHUB = 'github';

    public function __construct(public readonly string $reason, string $message, public readonly ?int $status = null)
    {
        parent::__construct($message);
    }
}
