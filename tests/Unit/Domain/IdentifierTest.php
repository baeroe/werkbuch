<?php

use App\Domain\Projects\Identifier;

it('validates identifiers', function (string $identifier, bool $valid) {
    expect(Identifier::isValid($identifier))->toBe($valid);
})->with([
    ['WEB', true], ['A1', true], ['OPS2026', true], ['ABCDEFGHIJ', true],
    ['W', false], ['1AB', false], ['WEB-1', false], ['ABCDEFGHIJK', false], ['web', false], ["WEB\n", false], ['', false],
]);

it('normalizes what a person typed', function () {
    expect(Identifier::normalize(' web '))->toBe('WEB')
        ->and(Identifier::normalize("ops2026\n"))->toBe('OPS2026');
});
