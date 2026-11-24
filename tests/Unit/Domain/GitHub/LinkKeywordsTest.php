<?php

use App\Domain\GitHub\KeywordHit;
use App\Domain\GitHub\LinkKeywords;

/*
 * The words of a PR that link it to items (spec 12, WEBU-25): closing words, linking words, `skip`, bare keys in the
 * text and in the branch; never in code; only keys of the project (also a former identifier).
 */

/** The hits as `number => kind`. */
$read = function (string $text, string $branch = '', array $identifiers = ['WEBU', 'OLD']): array {
    $hits = [];
    foreach (LinkKeywords::parse($text, $branch, $identifiers) as $hit) {
        $hits[$hit->number] = $hit->kind;
    }

    return $hits;
};

it('closes with every form of fix, close and resolve, in any case', function () use ($read) {
    foreach (['fix', 'fixes', 'fixed', 'fixing', 'close', 'closes', 'closed', 'closing', 'resolve', 'resolves', 'resolved', 'resolving', 'FIXES', 'Closes', 'rEsOlVeD'] as $word) {
        expect($read("{$word} WEBU-12"))->toBe([12 => KeywordHit::CLOSES], $word);
    }
});

it('only links with ref, refs, references, part of, relates to and related to', function () use ($read) {
    foreach (['ref', 'refs', 'references', 'part of', 'Part  of', 'relates to', 'related to', 'RELATED TO'] as $words) {
        expect($read("{$words} WEBU-7"))->toBe([7 => KeywordHit::LINKS], $words);
    }
});

it('reads a colon and several keys by comma or and', function () use ($read) {
    expect($read('Fixes: WEBU-12, WEBU-13 and webu-14'))->toBe([12 => KeywordHit::CLOSES, 13 => KeywordHit::CLOSES, 14 => KeywordHit::CLOSES])
        ->and($read('Closes WEBU-1,WEBU-2, and WEBU-3'))->toBe([1 => KeywordHit::CLOSES, 2 => KeywordHit::CLOSES, 3 => KeywordHit::CLOSES])
        ->and($read('Refs:WEBU-4 & WEBU-5'))->toBe([4 => KeywordHit::LINKS, 5 => KeywordHit::LINKS])
        // the list ends at the first word that is no key: the rest is only linked
        ->and($read('Fixes WEBU-1 and also WEBU-2'))->toBe([1 => KeywordHit::CLOSES, 2 => KeywordHit::LINKS]);
});

it('only links a key without a word, in the text or in the branch', function () use ($read) {
    expect($read('This fixes the bug of WEBU-12.'))->toBe([12 => KeywordHit::LINKS])
        ->and($read('', 'feat/webu-25-pr-links'))->toBe([25 => KeywordHit::LINKS])
        ->and($read('', 'agent/WEBU-3'))->toBe([3 => KeywordHit::LINKS])
        ->and($read('', 'fixes-webu-9'))->toBe([9 => KeywordHit::LINKS])
        ->and($read('See https://werkbuch.example.com/items/WEBU-8 (WEBU-9).'))->toBe([8 => KeywordHit::LINKS, 9 => KeywordHit::LINKS]);
});

it('lets skip and ignore unlink a key, also one of the branch', function () use ($read) {
    expect($read('skip WEBU-25', 'feat/webu-25-x'))->toBe([25 => KeywordHit::SKIP])
        ->and($read('Fixes WEBU-1. Ignore: WEBU-1, WEBU-2'))->toBe([1 => KeywordHit::SKIP, 2 => KeywordHit::SKIP]);
});

it('closes rather than links the same key named twice', function () use ($read) {
    expect($read('WEBU-4 is it. Resolves WEBU-4', 'webu-4'))->toBe([4 => KeywordHit::CLOSES]);
});

it('never reads a word or key in code, a fence or an HTML comment', function () use ($read) {
    $body = "Fixes WEBU-1\n\n```\nFixes WEBU-2\n```\n\n~~~~php\ncloses WEBU-3\n~~~~\n`fixes WEBU-4` and ``refs WEBU-5``\n<!-- Fixes WEBU-6 -->\n   ```\nFixes WEBU-7";

    expect($read($body))->toBe([1 => KeywordHit::CLOSES]);
});

it('counts only keys of the project, a former identifier too', function () use ($read) {
    // a list that begins with a key of another project is no list: WEBU-2 stands bare
    expect($read('Fixes OTHER-1, WEBU-2 and fixes old-3, WEBUX-4, XWEBU-5, WEBU-6a'))->toBe([2 => KeywordHit::LINKS, 3 => KeywordHit::CLOSES])
        ->and($read('Fixes WEBU-0, WEBU-9999999999, WEBU-99999999999'))->toBe([])
        ->and(LinkKeywords::parse('Fixes WEBU-1', '', []))->toBe([]);
});

it('names its hits in the order they first appear', function () {
    $hits = LinkKeywords::parse('WEBU-3 then fixes WEBU-1', 'webu-2', ['WEBU']);

    expect(array_map(fn (KeywordHit $hit) => [$hit->number, $hit->kind], $hits))->toBe([[3, KeywordHit::LINKS], [1, KeywordHit::CLOSES], [2, KeywordHit::LINKS]]);
});

it('pairs inline code within a paragraph only and reads a fence in a list item', function () use ($read) {
    // a backtick left open in one paragraph does not hide the next one
    expect($read("A stray ` here.\n\nFixes WEBU-1 and `WEBU-2`"))->toBe([1 => KeywordHit::CLOSES])
        ->and($read('``Fixes WEBU-3`` ` Fixes WEBU-4 ``` x'))->toBe([4 => KeywordHit::CLOSES])
        ->and($read("- item\n      ```\n      Fixes WEBU-5\n      ```\n- Fixes WEBU-6"))->toBe([6 => KeywordHit::CLOSES])
        // a backtick in the info string is no fence; a shorter closing fence closes nothing
        ->and($read("``` a`b\nFixes WEBU-7"))->toBe([7 => KeywordHit::CLOSES])
        ->and($read("````\nFixes WEBU-8\n```\nFixes WEBU-9\n````\nRefs WEBU-10"))->toBe([10 => KeywordHit::LINKS])
        ->and($read('<!-- a --> Fixes WEBU-11 <!-- Fixes WEBU-12'))->toBe([11 => KeywordHit::CLOSES]);
});

it('reads a large body with many backticks and comments in linear time', function () use ($read) {
    $body = str_repeat('a ` b `` c <!-- d --> ', 5_000)."\n\nFixes WEBU-13 ".str_repeat('x`', 5_000);
    $started = hrtime(true);

    expect(strlen($body))->toBeGreaterThan(65_000)
        ->and($read($body))->toBe([13 => KeywordHit::CLOSES])
        ->and((hrtime(true) - $started) / 1e9)->toBeLessThan(1.0);
});

it('fails loudly when PCRE gives up instead of reading an empty text', function () {
    $limit = ini_get('pcre.backtrack_limit');
    ini_set('pcre.backtrack_limit', '1');

    try {
        expect(fn () => LinkKeywords::parse(str_repeat('Fixes WEBU-1, ', 50), '', ['WEBU']))->toThrow(RuntimeException::class, 'Reading the words of a PR failed');
    } finally {
        ini_set('pcre.backtrack_limit', (string) $limit);
    }
});
