<?php

use App\Domain\Emoji;

/** One emoji of 64 bytes: two hearts and seven rockets joined by zero-width joiners. */
$longest = implode("\u{200D}", ["❤\u{FE0F}", "❤\u{FE0F}", ...array_fill(0, 7, '🚀')]);

it('takes one emoji', function (string $text) {
    expect(Emoji::is($text))->toBeTrue();
})->with([
    'a pictograph' => ['👍'],
    'one with a skin tone' => ['👍🏽'],
    'a text pictograph with a skin tone' => ["\u{261D}\u{1F3FD}"],
    'a sequence of zero-width joins' => ['👩‍💻'],
    'a join of a text pictograph with its selector' => ["🏃\u{200D}\u{2640}\u{FE0F}"],
    'a join that starts with a selector' => ["\u{1F441}\u{FE0F}\u{200D}\u{1F5E8}\u{FE0F}"],
    'a flag' => ['🇩🇪'],
    'a subdivision flag' => ["\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}"],
    'a keycap' => ["1\u{FE0F}\u{20E3}"],
    'a keycap without its selector' => ["1\u{20E3}"],
    'a number sign keycap' => ["#\u{FE0F}\u{20E3}"],
    'a text pictograph with its selector' => ["\u{2764}\u{FE0F}"],
    'a copyright sign with its selector' => ["\u{00A9}\u{FE0F}"],
    'a pictograph of Unicode 14' => ['🫠'],
    'one of 64 bytes' => [$longest],
]);

it('refuses everything else', function (string $text) {
    expect(Emoji::is($text))->toBeFalse();
})->with([
    'nothing' => [''],
    'a letter' => ['a'],
    'a copyright sign' => ["\u{00A9}"],
    'a double exclamation mark' => ["\u{203C}"],
    'a trade mark sign' => ["\u{2122}"],
    'a heart without its selector' => ["\u{2764}"],
    'a copyright sign with a skin tone' => ["\u{00A9}\u{1F3FD}"],
    'two emoji' => ['👍👍'],
    'an emoji and a space' => ['👍 '],
    'an emoji and a line break' => ["👍\n"],
    'half a flag' => ["\u{1F1E9}"],
    'a skin tone alone' => ["\u{1F3FD}"],
    'a keycap on a letter' => ["x\u{20E3}"],
    'a plain digit' => ['1'],
    'a subdivision flag without its end' => ["\u{1F3F4}\u{E0067}\u{E0062}"],
    'more than 64 bytes' => [$longest."\u{200D}🚀"],
    'not UTF-8' => ["\xF0\x9F\x91"],
]);

it('counts the bytes of the longest emoji it takes', function () use ($longest) {
    expect(strlen($longest))->toBe(Emoji::MAX_BYTES)
        ->and(strlen($longest."\u{200D}🚀"))->toBeGreaterThan(Emoji::MAX_BYTES);
});

it('accepts every emoji the picker offers', function () {
    $source = (string) file_get_contents(repo_path('resources/js/components/ui/EmojiPicker.tsx'));
    preg_match_all("/\['([^'\\[\\]]+)', '[a-z_]+'\]/u", $source, $offered);

    expect($offered[1])->toHaveCount(48);
    foreach ($offered[1] as $emoji) {
        expect(Emoji::is($emoji))->toBeTrue("the picker offers {$emoji}");
    }
});
