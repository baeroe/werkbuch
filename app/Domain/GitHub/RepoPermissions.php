<?php

namespace App\Domain\GitHub;

use App\Domain\Agents\RunType;

/**
 * What an installation token of a run may do in its one repo (spec 11.3, A511): a run that changes code pushes, opens
 * and updates its PR, reads checks and the logs of CI (`actions: read`, ticket WEBU-24); a review or an answer to a
 * comment only reads, hard (an overpowered agent cannot push or comment). `metadata: read` comes with every token.
 * Workflow files stay out of reach (no `workflows: write`): an agent cannot change CI. Merges, reviews, comments at the
 * PR and status checks werkbuch makes with tokens of its own (`OWN`).
 */
final class RepoPermissions
{
    /** What werkbuch's own short-lived tokens may (merge, review, comment, read checks and logs). */
    public const OWN = ['contents' => 'write', 'pull_requests' => 'write', 'checks' => 'read', 'actions' => 'read', 'statuses' => 'read', 'metadata' => 'read'];

    /**
     * @return array<string, string>
     */
    public static function forRun(RunType $type): array
    {
        return $type->light()
            ? ['contents' => 'read', 'pull_requests' => 'read', 'metadata' => 'read']
            : ['contents' => 'write', 'pull_requests' => 'write', 'checks' => 'read', 'actions' => 'read', 'metadata' => 'read'];
    }
}
