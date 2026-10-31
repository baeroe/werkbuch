<?php

use App\Domain\WorkItems\ItemKey;

it('reads a key regardless of case and surrounding space', function () {
    expect(ItemKey::parse(' web-123 '))->toBe(['identifier' => 'WEB', 'number' => 123])
        ->and(ItemKey::parse("WEB-12\n"))->toBe(['identifier' => 'WEB', 'number' => 12]);
});

it('rejects a key without a dash', function () {
    expect(ItemKey::parse('WEB123'))->toBeNull();
});

it('rejects an identifier that is too short', function () {
    expect(ItemKey::parse('W-1'))->toBeNull();
});

it('accepts identifiers of 2 to 10 characters and digits after the first letter', function () {
    expect(ItemKey::parse('ab-1'))->toBe(['identifier' => 'AB', 'number' => 1])
        ->and(ItemKey::parse('web2-7'))->toBe(['identifier' => 'WEB2', 'number' => 7])
        ->and(ItemKey::parse('ABCDEFGHIJ-5'))->toBe(['identifier' => 'ABCDEFGHIJ', 'number' => 5])
        ->and(ItemKey::parse('ABCDEFGHIJK-5'))->toBeNull();
});

it('rejects an identifier that starts with a digit or contains other characters', function () {
    expect(ItemKey::parse('2WEB-1'))->toBeNull()
        ->and(ItemKey::parse('WE_B-1'))->toBeNull()
        ->and(ItemKey::parse('ÄB-1'))->toBeNull();
});

it('rejects numbers that are not positive whole numbers', function () {
    expect(ItemKey::parse('WEB-0'))->toBeNull()
        ->and(ItemKey::parse('WEB--1'))->toBeNull()
        ->and(ItemKey::parse('WEB-1.5'))->toBeNull()
        ->and(ItemKey::parse('WEB-12x'))->toBeNull()
        ->and(ItemKey::parse('WEB-'))->toBeNull()
        ->and(ItemKey::parse('WEB-99999999999999999999'))->toBeNull();
});

it('rejects text around the key and empty input', function () {
    expect(ItemKey::parse('see WEB-1'))->toBeNull()
        ->and(ItemKey::parse(''))->toBeNull()
        ->and(ItemKey::parse('   '))->toBeNull()
        // the end of the text, not the end of a line
        ->and(ItemKey::parse("WEB-12\nx"))->toBeNull();
});

it('takes numbers up to the largest the column holds', function () {
    expect(ItemKey::MAX_NUMBER)->toBe(4294967295)
        ->and(ItemKey::parse('WEB-4294967295'))->toBe(['identifier' => 'WEB', 'number' => 4294967295])
        ->and(ItemKey::parse('WEB-4294967296'))->toBeNull()
        ->and(ItemKey::parse('WEB-9999999999'))->toBeNull();
});

it('is stricter than the clickdummy with long numbers and other blanks', function () {
    // the clickdummy reads any number of digits and trims every Unicode blank; the column holds ten digits, PHP trims
    // only ASCII blanks (REST requests lose the others to TrimStrings before)
    expect(ItemKey::parse('WEB-0000000001'))->toBe(['identifier' => 'WEB', 'number' => 1])
        ->and(ItemKey::parse('WEB-00000000001'))->toBeNull()
        ->and(ItemKey::parse("\u{00A0}WEB-1"))->toBeNull();
});
