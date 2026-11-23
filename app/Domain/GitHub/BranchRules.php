<?php

namespace App\Domain\GitHub;

/**
 * Whether the active rules of a branch (GitHub `GET /repos/{owner}/{repo}/rules/branches/{branch}`, rulesets of the repo
 * and its organization) keep a direct push off it: a rule `pull_request` (changes only through a PR) or `update`
 * (nobody may update it but the bypass). Only a hint in werkbuch (spec 10.2, A513): private repos on GitHub's free plan
 * have no rulesets, werkbuch works either way and notices an unauthorized push itself (spec 11.3).
 */
final class BranchRules
{
    public const PROTECTING = ['pull_request', 'update'];

    /**
     * @param  array<array-key, mixed>  $rules
     */
    public static function protects(array $rules): bool
    {
        foreach ($rules as $rule) {
            if (is_array($rule) && in_array($rule['type'] ?? null, self::PROTECTING, true)) {
                return true;
            }
        }

        return false;
    }
}
