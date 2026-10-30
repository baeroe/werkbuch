<?php

use App\Exceptions\Problem;

it('has the same keys in English and German, sorted', function () {
    [$en, $de] = [langKeys('en'), langKeys('de')];

    expect(array_values(array_diff($en, $de)))->toBe([], 'missing in de.json')
        ->and(array_values(array_diff($de, $en)))->toBe([], 'missing in en.json')
        ->and($en)->toBe(collect($en)->sort()->values()->all())
        ->and($de)->toBe($en);
});

it('keeps the placeholders of every key equal in both languages', function () {
    foreach (langKeys('en') as $key) {
        expect(placeholders(lang('de')[$key]))->toBe(placeholders(lang('en')[$key]), $key);
    }
});

it('has no empty text', function () {
    foreach (['en', 'de'] as $locale) {
        foreach (lang($locale) as $key => $text) {
            expect(trim($text))->not->toBe('', "{$locale}: {$key}");
        }
    }
});

it('follows the key schema and leaves framework groups to their PHP files', function () {
    foreach (langKeys('en') as $key) {
        expect($key)->toMatch('/^[a-z_]+(\.[a-z_]+)+$/')->not->toMatch('/^(auth|passwords|validation|pagination)\./');
    }
});

it('has a text for every problem reason and status title', function () {
    $needed = [
        ...array_map(fn ($reason) => "problem.reason.{$reason}", Problem::REASONS),
        ...array_map(fn ($status) => "problem.title.{$status}", ['bad_request', 'unauthenticated', 'forbidden', 'not_found', 'method_not_allowed', 'conflict', 'payload_too_large', 'csrf_token_mismatch', 'validation_failed', 'too_many_requests', 'server_error', 'service_unavailable', 'http_error']),
    ];

    expect(array_values(array_diff($needed, langKeys('en'))))->toBe([]);
});
