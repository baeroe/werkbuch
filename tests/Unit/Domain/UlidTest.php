<?php

use App\Domain\Ulid;
use Illuminate\Support\Str;

it('knows a ULID as the ulid rule of the framework does, in small letters', function (string $value) {
    expect(preg_match(Ulid::PATTERN, $value) === 1)->toBe(Str::isUlid($value) && $value === strtolower($value))
        ->and(Ulid::is($value))->toBe(Str::isUlid($value));
})->with([
    'a ULID' => ['01jbz8v6w2k7c0m9x4r5t3n8qa'],
    'the largest one' => ['7zzzzzzzzzzzzzzzzzzzzzzzzz'],
    'in capitals' => ['01JBZ8V6W2K7C0M9X4R5T3N8QA'],
    'beyond its range' => ['81jbz8v6w2k7c0m9x4r5t3n8qa'],
    'with an i' => ['01jbz8v6w2k7c0m9x4r5t3n8qi'],
    'with an l' => ['01jbz8v6w2k7c0m9x4r5t3n8ql'],
    'with an o' => ['01jbz8v6w2k7c0m9x4r5t3n8qo'],
    'with a u' => ['01jbz8v6w2k7c0m9x4r5t3n8qu'],
    'too short' => ['01jbz8v6w2k7c0m9x4r5t3n8q'],
    'too long' => ['01jbz8v6w2k7c0m9x4r5t3n8qaa'],
    'with a line break' => ["01jbz8v6w2k7c0m9x4r5t3n8qa\n"],
    'with full-width digits' => ['０1jbz8v6w2k7c0m9x4r5t3n8qa'],
]);
