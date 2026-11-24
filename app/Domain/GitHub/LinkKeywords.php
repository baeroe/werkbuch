<?php

namespace App\Domain\GitHub;

use App\Domain\WorkItems\ItemKey;

/**
 * The words of a PR that link it to items (spec 12): title and body (the text) and the name of the head branch. Only keys
 * of the project of the repo count (its identifier and its former ones, any case). In the text a closing word (`fixes`
 * …) before one or more keys links them and closes them on merge, a linking word (`refs`, `part of` …) only links,
 * `skip`/`ignore` takes a link back (also one of the branch); a key without a word, in the text or in the branch, only
 * links. A word may take a colon, its keys go by comma, `and` or `&`; the list ends at the first thing that is no key.
 * Nothing in code counts: fenced blocks, inline code and HTML comments of the body are read as if they were not
 * there. A key named several times takes the strongest: skip, then closes, then links. The words are GitHub's own,
 * in English, fixed in the code.
 */
final class LinkKeywords
{
    public const CLOSING = ['fix', 'fixes', 'fixed', 'fixing', 'close', 'closes', 'closed', 'closing', 'resolve', 'resolves', 'resolved', 'resolving'];

    public const LINKING = ['ref', 'refs', 'references', 'part of', 'relates to', 'related to'];

    public const SKIPPING = ['skip', 'ignore'];

    private const STRENGTH = [KeywordHit::LINKS => 1, KeywordHit::CLOSES => 2, KeywordHit::SKIP => 3];

    /**
     * The items the PR names, each once, in the order they first appear (the branch after the text).
     *
     * @param  list<string>  $identifiers  the identifier of the project and its former ones
     * @return list<KeywordHit>
     */
    public static function parse(string $text, string $branch, array $identifiers): array
    {
        if ($identifiers === []) {
            return [];
        }

        usort($identifiers, fn (string $a, string $b) => strlen($b) <=> strlen($a));
        $ids = implode('|', array_map(fn (string $id) => preg_quote($id, '/'), $identifiers));
        $text = self::withoutCode($text);
        // position → [number, kind]: the first position of a number orders it, its strongest kind wins
        $found = [];

        $key = "(?<![\\p{L}\\p{N}_-])(?:{$ids})-(\\d{1,10})(?![\\p{L}\\p{N}_])";
        preg_match_all("/{$key}/iu", $text, $bare, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
        foreach ($bare as $match) {
            $found[] = [$match[0][1], $match[1][0], KeywordHit::LINKS];
        }

        $words = implode('|', array_map(fn (string $word) => str_replace(' ', '\s+', $word), [...self::CLOSING, ...self::LINKING, ...self::SKIPPING]));
        preg_match_all("/(?<![\\p{L}\\p{N}_])({$words})\\s*:?\\s*(?={$key})/iu", $text, $phrases, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
        foreach ($phrases as $phrase) {
            $kind = self::kindOf((string) preg_replace('/\s+/', ' ', strtolower($phrase[1][0])));
            $offset = $phrase[0][1] + strlen($phrase[0][0]);

            // the keys of the list, one after the other from where the word ended
            while (preg_match("/\\G(?:\\s*(?:,|&|\\band\\b)\\s*(?:and\\s+)?)?{$key}/iu", $text, $next, PREG_OFFSET_CAPTURE, $offset) === 1) {
                $found[] = [$next[1][1], $next[1][0], $kind];
                $offset = $next[0][1] + strlen($next[0][0]);
            }
        }

        preg_match_all("/(?<![\\p{L}\\p{N}])(?:{$ids})-(\\d{1,10})(?!\\p{N})/iu", $branch, $branchKeys, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
        foreach ($branchKeys as $match) {
            $found[] = [strlen($text) + 1 + $match[0][1], $match[1][0], KeywordHit::LINKS];
        }

        return self::merge($found);
    }

    /**
     * The text as it reads outside of code: fenced blocks (to their closing fence or the end), inline code and HTML
     * comments become blanks of the same length, so positions stay.
     */
    private static function withoutCode(string $text): string
    {
        $blank = fn (array $match) => str_repeat(' ', strlen($match[0]));
        $text = (string) preg_replace_callback('/^[ \t]{0,3}(`{3,}|~{3,}).*?(?:^[ \t]{0,3}\1|\z)/msu', $blank, $text);
        $text = (string) preg_replace_callback('/(`+)(?!`).+?(?<!`)\1(?!`)/su', $blank, $text);

        return (string) preg_replace_callback('/<!--.*?(?:-->|\z)/su', $blank, $text);
    }

    private static function kindOf(string $word): string
    {
        return match (true) {
            in_array($word, self::CLOSING, true) => KeywordHit::CLOSES,
            in_array($word, self::SKIPPING, true) => KeywordHit::SKIP,
            default => KeywordHit::LINKS,
        };
    }

    /**
     * @param  list<array{0: int, 1: string, 2: string}>  $found  position, number as written, kind
     * @return list<KeywordHit>
     */
    private static function merge(array $found): array
    {
        usort($found, fn (array $a, array $b) => $a[0] <=> $b[0]);
        $kinds = [];

        foreach ($found as [, $written, $kind]) {
            $number = (int) $written;
            if ($number < 1 || $number > ItemKey::MAX_NUMBER) {
                continue;
            }

            $kinds[$number] = self::STRENGTH[$kind] > self::STRENGTH[$kinds[$number] ?? KeywordHit::LINKS] ? $kind : ($kinds[$number] ?? $kind);
        }

        return array_map(fn (int $number, string $kind) => new KeywordHit($number, $kind), array_keys($kinds), array_values($kinds));
    }
}
