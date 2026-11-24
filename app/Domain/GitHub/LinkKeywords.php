<?php

namespace App\Domain\GitHub;

use App\Domain\WorkItems\ItemKey;
use RuntimeException;

/**
 * The words of a PR that link it to items (spec 12): title and body (the text) and the name of the head branch. Only keys
 * of the project of the repo count (its identifier and its former ones, any case). In the text a closing word (`fixes`
 * …) before one or more keys links them and closes them on merge, a linking word (`refs`, `part of` …) only links,
 * `skip`/`ignore` takes a link back (also one of the branch); a key without a word, in the text or in the branch, only
 * links. A word may take a colon, its keys go by comma, `and` or `&`; the list ends at the first thing that is no key.
 * Nothing in code counts: fenced blocks, inline code and HTML comments of the body are read as if they were not
 * there, in time linear in the length of the text; a failure of PCRE is an error, never an empty text. A key named several times takes the strongest: skip, then closes, then links. The words are GitHub's own,
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
        $text = self::withoutCode(mb_scrub($text, 'UTF-8'));
        $branch = mb_scrub($branch, 'UTF-8');
        // position → [number, kind]: the first position of a number orders it, its strongest kind wins
        $found = [];

        $key = "(?<![\\p{L}\\p{N}_-])(?:{$ids})-(\\d{1,10})(?![\\p{L}\\p{N}_])";
        foreach (self::all("/{$key}/iu", $text) as $match) {
            $found[] = [$match[0][1], $match[1][0], KeywordHit::LINKS];
        }

        $words = implode('|', array_map(fn (string $word) => str_replace(' ', '\s+', $word), [...self::CLOSING, ...self::LINKING, ...self::SKIPPING]));
        foreach (self::all("/(?<![\\p{L}\\p{N}_])({$words})\\s*:?\\s*(?={$key})/iu", $text) as $phrase) {
            $kind = self::kindOf((string) preg_replace('/\s+/', ' ', strtolower($phrase[1][0])));

            // the keys of the list, one after the other from where the word ended (`\G`: each where the one before ended)
            foreach (self::all("/\\G(?:\\s*(?:,|&|\\band\\b)\\s*(?:and\\s+)?)?{$key}/iu", $text, $phrase[0][1] + strlen($phrase[0][0])) as $next) {
                $found[] = [$next[1][1], $next[1][0], $kind];
            }
        }

        foreach (self::all("/(?<![\\p{L}\\p{N}])(?:{$ids})-(\\d{1,10})(?!\\p{N})/iu", $branch) as $match) {
            $found[] = [strlen($text) + 1 + $match[0][1], $match[1][0], KeywordHit::LINKS];
        }

        return self::merge($found);
    }

    /**
     * The text as it reads outside of code (A542), in time linear in its length: fenced blocks (``` or ~~~ at any
     * indentation, so in list items too, to their closing fence or the end), inline code (a run of backticks up to the
     * next run of the same length within its paragraph, as CommonMark pairs them) and HTML comments become blanks of the
     * same length, so positions stay.
     */
    private static function withoutCode(string $text): string
    {
        $lines = explode("\n", $text);
        $fence = null;

        foreach ($lines as $index => $line) {
            if ($fence === null && preg_match('/^\s*(`{3,}|~{3,})(.*)$/', $line, $open) === 1 && ! ($open[1][0] === '`' && str_contains($open[2], '`'))) {
                $fence = [$open[1][0], strlen($open[1])];
                $lines[$index] = str_repeat(' ', strlen($line));
            } elseif ($fence !== null) {
                $closes = preg_match('/^\s*(`{3,}|~{3,})\s*$/', $line, $close) === 1 && $close[1][0] === $fence[0] && strlen($close[1]) >= $fence[1];
                $fence = $closes ? null : $fence;
                $lines[$index] = str_repeat(' ', strlen($line));
            }
        }

        $text = implode("\n", $lines);

        // inline code: the runs of backticks, paired per paragraph with the next run of the same length
        $runs = self::all('/`+/', $text);
        $breaks = array_map(fn (array $match) => $match[0][1], self::all('/\n[ \t]*\n/', $text));
        $paragraphs = [];
        $paragraph = 0;
        foreach ($runs as $run) {
            while (isset($breaks[$paragraph]) && $breaks[$paragraph] < $run[0][1]) {
                $paragraph++;
            }
            $paragraphs[$paragraph][] = [$run[0][1], strlen($run[0][0])];
        }

        foreach ($paragraphs as $inParagraph) {
            $text = self::blankCode($text, $inParagraph);
        }

        // HTML comments, to their end or the end of the text
        $position = 0;
        while (($start = strpos($text, '<!--', $position)) !== false) {
            $end = strpos($text, '-->', $start + 4);
            $stop = $end === false ? strlen($text) : $end + 3;
            $text = substr_replace($text, str_repeat(' ', $stop - $start), $start, $stop - $start);
            $position = $stop;
        }

        return $text;
    }

    /**
     * Blanks the inline code of a paragraph: each run of backticks opens a span that the next run of the same length
     * closes; a run without one is a run of plain backticks. Each pointer per length only moves forward.
     *
     * @param  list<array{0: int, 1: int}>  $runs  offset and length, in order
     */
    private static function blankCode(string $text, array $runs): string
    {
        $byLength = [];
        foreach ($runs as $index => [, $length]) {
            $byLength[$length][] = $index;
        }

        $pointer = [];
        $index = 0;
        while ($index < count($runs)) {
            [$offset, $length] = $runs[$index];
            $candidates = $byLength[$length];
            $at = $pointer[$length] ?? 0;
            while (isset($candidates[$at]) && $candidates[$at] <= $index) {
                $at++;
            }
            $pointer[$length] = $at + 1;

            if (isset($candidates[$at])) {
                $stop = $runs[$candidates[$at]][0] + $length;
                $text = substr_replace($text, str_repeat(' ', $stop - $offset), $offset, $stop - $offset);
                $index = $candidates[$at] + 1;
            } else {
                $index++;
            }
        }

        return $text;
    }

    /**
     * Every match with offsets; a failure of PCRE (a backtrack or JIT limit) is an error, never „no match“: a key the
     * reader missed would leave an item silently unlinked.
     *
     * @return list<array<int, array{0: string, 1: int}>>
     */
    private static function all(string $pattern, string $subject, int $offset = 0): array
    {
        if (preg_match_all($pattern, $subject, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE, $offset) === false) {
            throw new RuntimeException('Reading the words of a PR failed: '.preg_last_error_msg());
        }

        /** @var list<array<int, array{0: string, 1: int}>> $matches */
        return $matches;
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
