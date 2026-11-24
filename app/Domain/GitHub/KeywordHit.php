<?php

namespace App\Domain\GitHub;

/**
 * An item a PR names (spec 12): the number of its key in the project of the repo and what the PR does with it.
 */
final readonly class KeywordHit
{
    /** Linked, and closed when the PR is merged. */
    public const CLOSES = 'closes';

    /** Linked, never closed. */
    public const LINKS = 'links';

    /** Not linked: the PR takes back a link its branch or another text made. */
    public const SKIP = 'skip';

    public function __construct(public int $number, public string $kind) {}
}
