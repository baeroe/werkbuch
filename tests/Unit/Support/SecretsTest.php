<?php

use App\Support\Secrets;

// A made-up installation token in the form GitHub gives since 2026 (A730): `ghs_<app>_<JWT>`, base64url segments.
$jwt = 'ghs_123456_eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.'.str_repeat('eyJpc3MiOiIxMjM0NTYi-_', 15).'.'.str_repeat('c2ln_-Q', 40);

it('blanks the installation tokens of 2026 whole and keeps the dot that ends a sentence', function () use ($jwt) {
    expect(strlen($jwt))->toBeGreaterThan(500)
        ->and(Secrets::blank("pushed with {$jwt}."))->toBe('pushed with [token].')
        ->and(Secrets::blank("https://x-access-token:{$jwt}@github.com/acme/app.git"))->toBe('https://x-access-token:[token]@github.com/acme/app.git')
        ->and(Secrets::blank("{$jwt}\n{$jwt}"))->toBe("[token]\n[token]")
        ->and(Secrets::blank('github_pat_'.str_repeat('A1_b2', 12).'.x'))->toBe('[token]');
});

it('still blanks the tokens of the old form and leaves other text', function () {
    expect(Secrets::blank('push ghs_'.str_repeat('B', 36).', done'))->toBe('push [token], done')
        ->and(Secrets::blank('gho_'.str_repeat('a', 36)))->toBe('[token]')
        ->and(Secrets::blank('runner wbr_'.str_repeat('a', 40).' ok'))->toBe('runner [token] ok')
        ->and(Secrets::blank('the ghs_ prefix and github.com.'))->toBe('the ghs_ prefix and github.com.');
});
