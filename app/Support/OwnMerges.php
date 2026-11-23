<?php

namespace App\Support;

use App\Models\GitHubMerge;

/**
 * The merges werkbuch makes itself (spec 7.2, 11.3, A515): the flow (WEBU-26) notes a merge before it asks GitHub
 * (`expect`) and its commit after the answer (`merged`). A push of the app to the base branch whose commit is one of them
 * is werkbuch's own; while a merge of the repo is under way without its commit (the push can come before the answer),
 * the push is `pending` and its job looks again later.
 */
final class OwnMerges
{
    /** How long a merge without its commit keeps a push pending. */
    public const PENDING_MINUTES = 5;

    public const OWN = 'own';

    public const PENDING = 'pending';

    public const FOREIGN = 'foreign';

    public static function expect(string $repositoryId, int $prNumber): GitHubMerge
    {
        return GitHubMerge::query()->create(['repository_id' => $repositoryId, 'pr_number' => $prNumber, 'started_at' => now()]);
    }

    public static function merged(GitHubMerge $merge, string $sha): void
    {
        $merge->forceFill(['merge_sha' => strtolower($sha), 'merged_at' => now()])->save();
    }

    /** Whether a commit on the base branch of the repo is werkbuch's own merge, may still be, or is not. */
    public static function explain(string $repositoryId, string $sha): string
    {
        $merges = GitHubMerge::query()->where('repository_id', $repositoryId);

        if ((clone $merges)->where('merge_sha', strtolower($sha))->exists()) {
            return self::OWN;
        }

        return (clone $merges)->whereNull('merge_sha')->where('started_at', '>=', now()->subMinutes(self::PENDING_MINUTES))->exists()
            ? self::PENDING
            : self::FOREIGN;
    }
}
