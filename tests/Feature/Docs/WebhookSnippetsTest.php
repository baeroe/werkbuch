<?php

use App\Domain\Webhooks\Signature;
use App\Models\Webhook;
use Illuminate\Support\Facades\Process;

/*
 * The code that checks the signature in the webhook docs is tested code (A374): the PHP and the Python snippet run
 * against Signature::sign; the Node snippet runs in Vitest (scripts/webhook-snippets.test.mjs).
 */

$secret = 'whsec_'.str_repeat('Ab3', 14).'x';
$at = 1767225600;
$body = '{"id":"01kc0000000000000000000000","event":"bot.assigned","data":{"item":{"title":"Grüße / ✓"}}}';

beforeEach(function () {
    require_once repo_path('docs/snippets/webhooks/verify.php');
});

it('checks a signature of the server with the PHP snippet', function () use ($secret, $at, $body) {
    $signature = Signature::sign($secret, $at, $body);

    expect(verifyWerkbuchSignature($secret, (string) $at, $body, $signature, $at))->toBeTrue()
        ->and(verifyWerkbuchSignature($secret, $at, $body, $signature, $at + 300))->toBeTrue()
        ->and(verifyWerkbuchSignature($secret, (string) $at, str_replace('✓', 'x', $body), $signature, $at))->toBeFalse()
        ->and(verifyWerkbuchSignature("{$secret}x", (string) $at, $body, $signature, $at))->toBeFalse()
        ->and(verifyWerkbuchSignature($secret, (string) $at, $body, $signature, $at + 301))->toBeFalse()
        ->and(verifyWerkbuchSignature($secret, (string) $at, $body, $signature, $at - 301))->toBeFalse();
});

it('answers false in the PHP snippet for a missing or malformed header', function () use ($secret, $at, $body) {
    $signature = Signature::sign($secret, $at, $body);

    expect(verifyWerkbuchSignature($secret, null, $body, $signature, $at))->toBeFalse()
        ->and(verifyWerkbuchSignature($secret, (string) $at, $body, null, $at))->toBeFalse()
        ->and(verifyWerkbuchSignature($secret, "{$at}\n", $body, $signature, $at))->toBeFalse()
        ->and(verifyWerkbuchSignature($secret, '', $body, $signature, $at))->toBeFalse()
        ->and(verifyWerkbuchSignature($secret, (string) $at, $body, 'sha256=zz', $at))->toBeFalse();
});

it('checks a signature of the server with the Python snippet', function () use ($secret, $at, $body) {
    $python = Process::run(['python3', '--version']);
    if (! $python->successful()) {
        $this->markTestSkipped('python3 is not installed here; the CI runner has it.');
    }

    // the snippet's function with the arguments as JSON (null stands for a missing header), the answer as JSON
    $run = fn (array $arguments): string => trim(Process::path(repo_path('docs/snippets/webhooks'))->run([
        'python3', '-B', '-c',
        'import json, sys; sys.path.insert(0, "."); from verify import verify_werkbuch_signature as v; '
        .'a = json.loads(sys.argv[1]); print(json.dumps(v(a[0], a[1], a[2].encode("utf-8"), a[3], a[4])))',
        json_encode($arguments, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    ])->throw()->output());

    $signature = Signature::sign($secret, $at, $body);

    expect($run([$secret, (string) $at, $body, $signature, $at]))->toBe('true')
        ->and($run([$secret, (string) $at, $body, $signature, $at + 300]))->toBe('true')
        ->and($run([$secret, (string) $at, str_replace('✓', 'x', $body), $signature, $at]))->toBe('false')
        ->and($run(["{$secret}x", (string) $at, $body, $signature, $at]))->toBe('false')
        ->and($run([$secret, (string) $at, $body, $signature, $at + 301]))->toBe('false')
        ->and($run([$secret, null, $body, $signature, $at]))->toBe('false')
        ->and($run([$secret, (string) $at, $body, null, $at]))->toBe('false')
        ->and($run([$secret, "{$at}\n", $body, $signature, $at]))->toBe('false')
        ->and($run([$secret, (string) $at, $body, 'sha256=ü', $at]))->toBe('false');
});

it('lists every event of the catalog in the docs, in its order', function () {
    foreach (['en', 'de'] as $language) {
        $page = (string) file_get_contents(repo_path("docs/{$language}/webhooks.md"));
        $table = (string) preg_replace('/\A.*<!-- events:start -->(.*)<!-- events:end -->.*\z/s', '$1', $page);
        preg_match_all('/^\| `([a-z_]+\.[a-z_]+)` \|/m', $table, $rows);

        expect($rows[1])->toBe(Webhook::catalog(), $language);
    }
});

it('includes the three snippets in both languages', function () {
    foreach (['en', 'de'] as $language) {
        expect((string) file_get_contents(repo_path("docs/{$language}/webhooks.md")))
            ->toContain('<<< @/snippets/webhooks/verify.mjs', '<<< @/snippets/webhooks/verify.php', '<<< @/snippets/webhooks/verify.py');
    }
});
