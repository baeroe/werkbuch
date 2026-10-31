<?php

use App\Domain\Properties\FieldType;
use App\Domain\Properties\ItemValue;
use App\Domain\Properties\PropertyShape;

$ulid = '01jbz8v6w2k7c0m9x4r5t3n8qa';
$other = '01jbz8v6w2k7c0m9x4r5t3n8qb';
$doc = ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Hallo']]]]];
$longUrl = 'https://example.com/'.str_repeat('a', 2029);

/** A property of the type with the options opt_a and opt_b (opt_old is archived and not among them). */
$shape = fn (FieldType $type, bool $multiple = false, int $decimals = 0): PropertyShape => new PropertyShape($type, $decimals, $multiple, ['opt_a', 'opt_b']);

it('normalizes an item value', function (FieldType $type, bool $multiple, mixed $value, mixed $current, mixed $expected) use ($shape) {
    $result = ItemValue::normalize($shape($type, $multiple, 1), $value, $current);

    expect($result->ok())->toBeTrue()
        ->and($result->value)->toBe($expected);
})->with([
    'text trimmed' => [FieldType::Text, false, ' Safari ', null, 'Safari'],
    'number with a comma' => [FieldType::Number, false, '3,46', null, 3.5],
    'number whole' => [FieldType::Number, false, 7, null, 7],
    'dropdown active option' => [FieldType::Dropdown, false, 'opt_a', null, 'opt_a'],
    'dropdown archived option the item already has' => [FieldType::Dropdown, false, 'opt_old', 'opt_old', 'opt_old'],
    'dropdown multiple keeps an archived option it has' => [FieldType::Dropdown, true, ['opt_old', 'opt_a'], ['opt_old'], ['opt_old', 'opt_a']],
    'dropdown multiple without doubles' => [FieldType::Dropdown, true, ['opt_a', 'opt_a'], null, ['opt_a']],
    'dropdown multiple without a choice' => [FieldType::Dropdown, true, [], null, null],
    'boolean false' => [FieldType::Boolean, false, false, null, false],
    'date' => [FieldType::Date, false, '2026-10-31', null, '2026-10-31'],
    'url' => [FieldType::Url, false, ' https://example.com/x ', null, 'https://example.com/x'],
    'url at the limit' => [FieldType::Url, false, 'https://example.com/'.str_repeat('a', 2028), null, 'https://example.com/'.str_repeat('a', 2028)],
    'member' => [FieldType::Member, false, $ulid, null, $ulid],
    'member in capitals' => [FieldType::Member, false, strtoupper($ulid), null, strtoupper($ulid)],
    'member multiple' => [FieldType::Member, true, [$ulid, $other], null, [$ulid, $other]],
    'member multiple single id' => [FieldType::Member, true, $ulid, null, [$ulid]],
    'member multiple without doubles' => [FieldType::Member, true, [$ulid, $other, $ulid], null, [$ulid, $other]],
    'member multiple without anyone' => [FieldType::Member, true, [], null, null],
    'rich text' => [FieldType::RichText, false, ['type' => 'doc', 'content' => []], null, ['type' => 'doc', 'content' => []]],
    'rich text with text' => [FieldType::RichText, false, $doc, null, $doc],
    'nothing' => [FieldType::Member, false, null, null, null],
]);

it('rejects an item value that does not fit', function (FieldType $type, bool $multiple, mixed $value, mixed $current, string $error) use ($shape) {
    $result = ItemValue::normalize($shape($type, $multiple), $value, $current);

    expect($result->ok())->toBeFalse()
        ->and($result->error)->toBe($error)
        ->and($result->value)->toBeNull();
})->with([
    'text too long' => [FieldType::Text, false, str_repeat('a', 256), null, 'text'],
    'number is text' => [FieldType::Number, false, 'abc', null, 'number'],
    'dropdown archived option without it' => [FieldType::Dropdown, false, 'opt_old', null, 'option'],
    'dropdown archived option the item had another' => [FieldType::Dropdown, false, 'opt_old', 'opt_a', 'option'],
    'dropdown list for one value' => [FieldType::Dropdown, false, ['opt_a'], null, 'single'],
    'dropdown multiple unknown option' => [FieldType::Dropdown, true, ['opt_a', 'opt_x'], ['opt_a'], 'option'],
    'boolean is text' => [FieldType::Boolean, false, 'yes', null, 'boolean'],
    'date not a day' => [FieldType::Date, false, '2026-02-30', null, 'date'],
    'url with another scheme' => [FieldType::Url, false, 'ftp://example.com', null, 'url'],
    'url too long' => [FieldType::Url, false, $longUrl, null, 'url'],
    'url with a blank inside' => [FieldType::Url, false, 'https://example.com/a b', null, 'url_invalid'],
    'member is a handle' => [FieldType::Member, false, 'mara', null, 'member'],
    'member is a number' => [FieldType::Member, true, [12], null, 'member'],
    'member beyond the largest ULID' => [FieldType::Member, false, '81jbz8v6w2k7c0m9x4r5t3n8qa', null, 'member'],
    'member with a letter outside the alphabet' => [FieldType::Member, false, '01jbz8v6w2k7c0m9x4r5t3n8qu', null, 'member'],
    'member with a trailing newline' => [FieldType::Member, false, $ulid."\n", null, 'member'],
    'member list for one person' => [FieldType::Member, false, [$ulid], null, 'single'],
    'rich text is plain text' => [FieldType::RichText, false, 'text', null, 'rich_text'],
    'rich text is no document' => [FieldType::RichText, false, ['type' => 'paragraph'], null, 'rich_text'],
    'rich text is a list' => [FieldType::RichText, false, [['type' => 'doc']], null, 'rich_text'],
]);

it('keeps the limits of a text and an address', function () use ($longUrl) {
    expect(ItemValue::TEXT_MAX)->toBe(255)
        ->and(ItemValue::URL_MAX)->toBe(2048)
        ->and(mb_strlen($longUrl))->toBe(2049);
});

it('knows an empty value', function (mixed $value, bool $empty) {
    expect(ItemValue::isEmpty($value))->toBe($empty);
})->with([
    'nothing' => [null, true],
    'empty text' => ['', true],
    'blank text' => ['  ', true],
    'text' => [' a ', false],
    'empty list' => [[], true],
    'list' => [['opt_a'], false],
    'document of empty paragraphs' => [['type' => 'doc', 'content' => [['type' => 'paragraph'], ['type' => 'paragraph', 'content' => []]]], true],
    'document of blanks and line breaks' => [['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => " \u{00A0}\u{FEFF}"], ['type' => 'hardBreak']]]]], true],
    'document with text' => [['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'x']]]]], false],
    'document with a mention' => [['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'mention', 'attrs' => ['id' => 'u_1']]]]]], false],
    'zero' => [0, false],
    'zero as a float' => [0.0, false],
    'false' => [false, false],
]);

it('reads a document as blank the way the clickdummy does', function () {
    // only text and mentions count; a document of other nodes, broken content or a text in a list item is read as such
    expect(ItemValue::isBlankDoc(['type' => 'doc']))->toBeTrue()
        ->and(ItemValue::isBlankDoc(['type' => 'doc', 'content' => 'x']))->toBeTrue()
        ->and(ItemValue::isBlankDoc(['type' => 'doc', 'content' => ['x', ['type' => 'horizontalRule']]]))->toBeTrue()
        ->and(ItemValue::isBlankDoc(['type' => 'doc', 'content' => [['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => 'Punkt']]]]]]]]]))->toBeFalse()
        // a mention without a label still counts (the clickdummy writes "@")
        ->and(ItemValue::isBlankDoc(['type' => 'mention']))->toBeFalse();
});

it('trims text with PHP, so a no-break space alone is not empty', function () {
    // the clickdummy's trim() drops every Unicode blank; REST requests lose them to TrimStrings before
    expect(ItemValue::isEmpty("\u{00A0}"))->toBeFalse()
        ->and(ItemValue::normalize(new PropertyShape(FieldType::Text, 0, false, []), "\u{00A0}")->value)->toBe("\u{00A0}");
});
