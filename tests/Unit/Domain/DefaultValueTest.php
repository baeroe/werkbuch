<?php

use App\Domain\Properties\DefaultValue;
use App\Domain\Properties\FieldType;

it('normalizes a default value', function (FieldType $type, int $decimals, bool $multiple, mixed $value, mixed $expected) {
    $result = DefaultValue::normalize($type, $decimals, $multiple, ['opt_a', 'opt_b'], $value);

    expect($result->ok())->toBeTrue()
        ->and($result->error)->toBeNull()
        ->and($result->value)->toBe($expected);
})->with([
    'text trimmed' => [FieldType::Text, 0, false, ' Safari ', 'Safari'],
    'text at the limit' => [FieldType::Text, 0, false, str_repeat('ä', 255), str_repeat('ä', 255)],
    'text blank, no default' => [FieldType::Text, 0, false, " \t ", null],
    'text empty, no default' => [FieldType::Text, 0, false, '', null],
    'number rounded' => [FieldType::Number, 1, false, 3.46, 3.5],
    'number with a comma' => [FieldType::Number, 1, false, '3,46', 3.5],
    'number with a point' => [FieldType::Number, 2, false, '-3.456', -3.46],
    'number whole' => [FieldType::Number, 0, false, 7, 7],
    'number rounded to whole' => [FieldType::Number, 0, false, 6.6, 7],
    'dropdown single' => [FieldType::Dropdown, 0, false, 'opt_a', 'opt_a'],
    'dropdown multiple single id' => [FieldType::Dropdown, 0, true, 'opt_a', ['opt_a']],
    'dropdown multiple' => [FieldType::Dropdown, 0, true, ['opt_a', 'opt_b'], ['opt_a', 'opt_b']],
    'dropdown multiple without doubles' => [FieldType::Dropdown, 0, true, ['opt_a', 'opt_a', 'opt_b'], ['opt_a', 'opt_b']],
    'dropdown multiple without a choice, no default' => [FieldType::Dropdown, 0, true, [], null],
    'boolean false' => [FieldType::Boolean, 0, false, false, false],
    'boolean true' => [FieldType::Boolean, 0, false, true, true],
    'date' => [FieldType::Date, 0, false, '2026-10-31', '2026-10-31'],
    'date on a leap day' => [FieldType::Date, 0, false, '2028-02-29', '2028-02-29'],
    'url' => [FieldType::Url, 0, false, 'https://example.com/x', 'https://example.com/x'],
    'url trimmed, any case' => [FieldType::Url, 0, false, ' HTTP://example.com ', 'HTTP://example.com'],
]);

it('rejects a default value that does not fit', function (FieldType $type, bool $multiple, mixed $value, string $error) {
    $result = DefaultValue::normalize($type, 1, $multiple, ['opt_a', 'opt_b'], $value);

    expect($result->ok())->toBeFalse()
        ->and($result->error)->toBe($error)
        ->and($result->value)->toBeNull();
})->with([
    'text too long' => [FieldType::Text, false, str_repeat('a', 256), 'text'],
    'text is no string' => [FieldType::Text, false, 12, 'text'],
    'number is text' => [FieldType::Number, false, 'abc', 'number'],
    'number in exponent form' => [FieldType::Number, false, '1e3', 'number'],
    'number with a trailing newline' => [FieldType::Number, false, "3\n", 'number'],
    'number is infinite' => [FieldType::Number, false, INF, 'number'],
    'number is not a number' => [FieldType::Number, false, NAN, 'number'],
    'number is too long for a float' => [FieldType::Number, false, str_repeat('9', 400), 'number'],
    'number is a boolean' => [FieldType::Number, false, true, 'number'],
    'dropdown unknown option' => [FieldType::Dropdown, false, 'opt_x', 'option'],
    'dropdown list for one value' => [FieldType::Dropdown, false, ['opt_a'], 'single'],
    'dropdown multiple unknown option' => [FieldType::Dropdown, true, ['opt_x'], 'option'],
    'dropdown multiple one unknown option' => [FieldType::Dropdown, true, ['opt_a', 'opt_x'], 'option'],
    'dropdown option is no string' => [FieldType::Dropdown, false, 1, 'option'],
    'boolean is text' => [FieldType::Boolean, false, 'yes', 'boolean'],
    'boolean is a number' => [FieldType::Boolean, false, 1, 'boolean'],
    'date not a day' => [FieldType::Date, false, '2026-02-30', 'date'],
    'date in German form' => [FieldType::Date, false, '31.10.2026', 'date'],
    'date with a trailing newline' => [FieldType::Date, false, "2026-10-31\n", 'date'],
    'date is no string' => [FieldType::Date, false, 20261031, 'date'],
    'url with another scheme' => [FieldType::Url, false, 'ftp://example.com', 'url'],
    'url without a scheme' => [FieldType::Url, false, 'example.com', 'url'],
    'url without a host' => [FieldType::Url, false, 'https://', 'url'],
    'url is no string' => [FieldType::Url, false, 12, 'url'],
    'url with a blank inside' => [FieldType::Url, false, 'https://example.com/a b', 'url'],
    'url with a line break inside' => [FieldType::Url, false, "https://example.com/a\nb", 'url'],
    'url with a control character' => [FieldType::Url, false, "https://example.com/\x07", 'url'],
    'url with a host PHP does not read' => [FieldType::Url, false, 'https://exa mple.com', 'url'],
    'url with a host of an underscore' => [FieldType::Url, false, 'http://_', 'url'],
    'url with an empty part in the host' => [FieldType::Url, false, 'https://a..b', 'url'],
    'member has no default' => [FieldType::Member, true, ['u_1'], 'none'],
    'rich text has no default' => [FieldType::RichText, false, ['type' => 'doc'], 'none'],
]);

it('accepts no default at all for every field type', function (FieldType $type) {
    $result = DefaultValue::normalize($type, 0, false, [], null);

    expect($result->ok())->toBeTrue()
        ->and($result->value)->toBeNull();
})->with(FieldType::cases());

it('keeps the limit of a text default at 255 characters', function () {
    expect(DefaultValue::TEXT_MAX)->toBe(255);
});
