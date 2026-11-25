<?php

namespace App\Support;

/**
 * Blanks tokens in a text werkbuch keeps from outside (the log of a run, spec 2: no secret in a log): personal access
 * tokens (`<id>|wb_…`, also the secret alone), runner tokens (`wbr_…`) and the tokens of GitHub (`ghs_`, `ghp_`, `gho_`, `ghu_`, `ghr_`,
 * `github_pat_`), whole: also the installation tokens of 2026 (`ghs_<app>_<JWT>`, A730) with the dots of the JWT; a dot
 * that ends a sentence stays.
 *
 * The GitHub patterns are possessive (a chain of thousands of `.x` stays linear, never the backtrack limit of PCRE) and
 * start after anything but a letter or digit, or right after a percent escape (`x-access-token%3Aghs_…` in an encoded
 * URL). They blank every word that looks like a token, also a name such as `ghs_installation_token_cache_key`: on
 * purpose, a log loses a word rather than a secret. Should PCRE still fail, the whole text goes (UNREADABLE), never the
 * text with its token.
 */
final class Secrets
{
    public const BLANK = '[token]';

    /** What stands for a whole text PCRE could not go through. */
    public const UNREADABLE = '[redacted]';

    private const PATTERNS = [
        '/\b[0-9A-Za-z]{26}\|wb_[A-Za-z0-9]{20,}/',
        '/\bwb_[A-Za-z0-9]{40,}/',
        '/\bwbr_[A-Za-z0-9]{20,}/',
        '/(?:(?<![A-Za-z0-9])|(?<=%[0-9A-Fa-f]{2}))gh[pousr]_[A-Za-z0-9_-]{20,}+(?:\.[A-Za-z0-9_-]++)*+/',
        '/(?:(?<![A-Za-z0-9])|(?<=%[0-9A-Fa-f]{2}))github_pat_[A-Za-z0-9_-]{20,}+(?:\.[A-Za-z0-9_-]++)*+/',
    ];

    public static function blank(string $text): string
    {
        return preg_replace(self::PATTERNS, self::BLANK, $text) ?? self::UNREADABLE;
    }
}
