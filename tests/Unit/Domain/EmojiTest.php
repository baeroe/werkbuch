<?php

use App\Domain\Emoji;

/**
 * The cases of resources/js/domain/emoji-fixtures.json, which emoji.test.ts reads as well (T2-M4): the browser offers
 * what this rule takes, nothing else.
 *
 * @return array<string, array{string}>
 */
$cases = function (string $kind): array {
    $fixtures = json_decode((string) file_get_contents(repo_path('resources/js/domain/emoji-fixtures.json')), true);

    return array_map(fn (string $text) => [$text], $fixtures[$kind]);
};
$longest = $cases('takes')['one of 64 bytes'][0];

it('takes one emoji', function (string $text) {
    expect(Emoji::is($text))->toBeTrue();
})->with($cases('takes'));

it('refuses everything else', function (string $text) {
    expect(Emoji::is($text))->toBeFalse();
})->with([
    ...$cases('refuses'),
    // JSON holds UTF-8 only
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
