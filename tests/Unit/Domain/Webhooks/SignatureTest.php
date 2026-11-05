<?php

use App\Domain\Webhooks\Signature;

$secret = 'whsec_test';
$at = 1767225600; // 2026-01-01 00:00:00 UTC
$body = '{"id":"x"}';
// hash_hmac('sha256', '1767225600.{"id":"x"}', 'whsec_test'), also `printf '1767225600.{"id":"x"}' | openssl dgst -sha256 -hmac whsec_test`
$vector = 'sha256=f2a0e9cc79f6a8d5063bc6718561e872509983827740ea4ee5622da1c7e8d2b4';

it('signs the timestamp, a dot and the body', function () use ($secret, $at, $body, $vector) {
    expect(Signature::PREFIX)->toBe('sha256=')
        ->and(Signature::sign($secret, $at, $body))->toBe($vector)
        ->and(Signature::sign($secret, $at, $body))->toBe(Signature::PREFIX.hash_hmac('sha256', "{$at}.{$body}", $secret));
});

it('verifies its own signature within the window', function () use ($secret, $at, $body, $vector) {
    expect(Signature::verify($secret, $at, $body, $vector, $at))->toBeTrue()
        ->and(Signature::verify($secret, $at, $body, $vector, $at + 300))->toBeTrue()
        ->and(Signature::verify($secret, $at, $body, $vector, $at - 300))->toBeTrue()
        ->and(Signature::verify($secret, $at, $body, $vector, $at + 60, 60))->toBeTrue();
});

it('refuses a wrong secret', function () use ($at, $body, $vector) {
    expect(Signature::verify('whsec_other', $at, $body, $vector, $at))->toBeFalse();
});

it('refuses a body with one byte changed', function () use ($secret, $at, $vector) {
    expect(Signature::verify($secret, $at, '{"id":"y"}', $vector, $at))->toBeFalse()
        ->and(Signature::verify($secret, $at, '{"id":"x"} ', $vector, $at))->toBeFalse();
});

it('refuses another timestamp', function () use ($secret, $at, $body, $vector) {
    expect(Signature::verify($secret, $at + 1, $body, $vector, $at + 1))->toBeFalse();
});

it('refuses a time outside the window', function () use ($secret, $at, $body, $vector) {
    expect(Signature::verify($secret, $at, $body, $vector, $at + 301))->toBeFalse()
        ->and(Signature::verify($secret, $at, $body, $vector, $at - 301))->toBeFalse()
        ->and(Signature::verify($secret, $at, $body, $vector, $at + 61, 60))->toBeFalse();
});

it('refuses a header without the prefix', function () use ($secret, $at, $body, $vector) {
    $hex = substr($vector, strlen(Signature::PREFIX));

    expect(Signature::verify($secret, $at, $body, $hex, $at))->toBeFalse()
        ->and(Signature::verify($secret, $at, $body, 'sha1='.$hex, $at))->toBeFalse()
        ->and(Signature::verify($secret, $at, $body, strtoupper($vector), $at))->toBeFalse()
        ->and(Signature::verify($secret, $at, $body, '', $at))->toBeFalse();
});
