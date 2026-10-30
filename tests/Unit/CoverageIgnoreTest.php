<?php

/**
 * Lines in $code that carry @codeCoverageIgnore (also Start/End) without a reason of at least three words.
 *
 * @return list<string>
 */
function unjustifiedCoverageIgnores(string $code, string $file = 'code'): array
{
    $hits = [];

    foreach (explode("\n", $code) as $index => $line) {
        if (preg_match('/@codeCoverageIgnore(?:Start|End)?(?<reason>.*)$/', $line, $match) !== 1) {
            continue;
        }

        $reason = trim($match['reason'], " \t\r*/");

        if (count(preg_split('/\s+/', $reason, -1, PREG_SPLIT_NO_EMPTY) ?: []) < 3) {
            $hits[] = $file.':'.($index + 1);
        }
    }

    return $hits;
}

it('detects coverage ignores without a reason', function () {
    expect(unjustifiedCoverageIgnores('// @codeCoverageIgnore'))->toBe(['code:1'])
        ->and(unjustifiedCoverageIgnores('// @codeCoverageIgnore the CLI never runs this branch'))->toBe([]);
});

it('gives every coverage ignore in app/ a reason of at least three words', function () {
    $hits = collect(appFiles('app'))
        ->flatMap(fn (string $f) => unjustifiedCoverageIgnores((string) file_get_contents(repo_path($f)), $f))->all();

    expect($hits)->toBe([]);
});
