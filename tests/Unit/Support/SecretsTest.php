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

it('stays linear on a long chain of dots and blanks a token in an encoded URL', function () {
    $chain = 'ghs_'.str_repeat('a', 30).str_repeat('.x', 10000);

    expect(Secrets::blank("before {$chain} after"))->toBe('before [token] after')
        ->and(Secrets::blank('https://x-access-token%3Aghs_'.str_repeat('C', 36).'.e30.c2ln%40github.com'))->toBe('https://x-access-token%3A[token]%40github.com')
        ->and(Secrets::blank('cache ghs_installation_token_cache_key'))->toBe('cache [token]')
        ->and(Secrets::blank('A1ghs_'.str_repeat('a', 30)))->toBe('A1ghs_'.str_repeat('a', 30));
});

it('drops the whole text when PCRE gives up, never the text with its token', function () {
    $limit = ini_get('pcre.backtrack_limit');
    ini_set('pcre.backtrack_limit', '1');

    try {
        expect(Secrets::blank('push ghs_'.str_repeat('a', 36)))->toBe(Secrets::UNREADABLE);
    } finally {
        ini_set('pcre.backtrack_limit', (string) $limit);
    }
});
