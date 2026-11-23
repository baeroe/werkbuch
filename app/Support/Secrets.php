<?php

namespace App\Support;

/**
 * Blanks tokens in a text werkbuch keeps from outside (the log of a run, spec 2: no secret in a log): personal access
 * tokens (`<id>|wb_…`, also the secret alone), runner tokens (`wbr_…`) and the tokens of GitHub (`ghs_`, `ghp_`, `gho_`, `ghu_`, `ghr_`,
 * `github_pat_`).
 */
final class Secrets
{
    public const BLANK = '[token]';

    private const PATTERNS = [
        '/\b[0-9A-Za-z]{26}\|wb_[A-Za-z0-9]{20,}/',
        '/\bwb_[A-Za-z0-9]{40,}/',
        '/\bwbr_[A-Za-z0-9]{20,}/',
        '/\bgh[pousr]_[A-Za-z0-9]{20,}/',
        '/\bgithub_pat_[A-Za-z0-9_]{20,}/',
    ];

    public static function blank(string $text): string
    {
        return (string) preg_replace(self::PATTERNS, self::BLANK, $text);
    }
}
