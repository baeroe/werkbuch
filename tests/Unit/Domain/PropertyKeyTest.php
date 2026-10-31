<?php

use App\Domain\Properties\PropertyKey;

it('validates property keys', function (string $key, bool $valid) {
    expect(PropertyKey::isValid($key))->toBe($valid);
})->with([
    ['customer', true], ['effort', true], ['a', true], ['target_quarter_2', true], [str_repeat('a', 40), true],
    ['Customer', false], ['1st', false], ['_x', false], ['a-b', false], ['ä', false], [str_repeat('a', 41), false],
    ["customer\n", false], ['', false],
]);

it('knows the core fields', function () {
    expect(PropertyKey::isCore('title'))->toBeTrue()
        ->and(PropertyKey::isCore('labels'))->toBeTrue()
        ->and(PropertyKey::isCore('customer'))->toBeFalse();
});
