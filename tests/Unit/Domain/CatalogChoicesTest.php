<?php

use App\Domain\Catalog\Tone;
use App\Domain\Catalog\TypeIcon;
use App\Domain\Properties\FieldType;
use App\Domain\Properties\PropertyKey;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;

/** The quoted words of the union `export type $name = 'a' | 'b';` in the interface's types, sorted. */
$typeUnion = function (string $name): array {
    preg_match('/export type '.$name.' = ([^;]+);/', file_get_contents(repo_path('resources/js/types.ts')), $match);
    preg_match_all("/'([^']+)'/", $match[1], $words);
    sort($words[1]);

    return $words[1];
};

/** @var Closure(list<BackedEnum>): list<int|string> $sortedValues */
$sortedValues = function (array $cases): array {
    $values = array_map(fn (BackedEnum $case) => $case->value, $cases);
    sort($values);

    return $values;
};

it('offers the same tones as the interface', function () use ($sortedValues, $typeUnion) {
    expect($sortedValues(Tone::cases()))->toBe($typeUnion('TypeTone'));
});

it('offers the same state icons as the interface', function () use ($sortedValues, $typeUnion) {
    expect($sortedValues(StateIcon::cases()))->toBe($typeUnion('StateIcon'));
});

it('offers the same field types as the interface', function () use ($sortedValues, $typeUnion) {
    expect($sortedValues(FieldType::cases()))->toBe($typeUnion('FieldType'));
});

it('offers the same state categories as the interface', function () use ($sortedValues, $typeUnion) {
    expect($sortedValues(StateCategory::cases()))->toBe($typeUnion('StateCategory'));
});

it('offers the same type icons as the interface', function () {
    preg_match('/TYPE_ICONS = \{(.*?)\} satisfies/s', file_get_contents(repo_path('resources/js/components/ui/TypeTab.tsx')), $block);
    preg_match_all("/^\s*(?:'([a-z-]+)'|([a-z]+)):/m", $block[1], $keys);
    $names = array_values(array_filter(array_merge($keys[1], $keys[2])));
    sort($names);
    $mine = TypeIcon::NAMES;
    sort($mine);

    expect($names)->toHaveCount(20)
        ->and($mine)->toBe($names);
});

it('keeps the core keys of the clickdummy', function () {
    preg_match('/CORE_KEYS = new Set\(\[(.*?)\]\)/s', file_get_contents(repo_path('prototypes/clickdummy/src/api/properties.ts')), $block);
    preg_match_all("/'([a-z_]+)'/", $block[1], $words);
    $keys = $words[1];
    sort($keys);
    $mine = PropertyKey::CORE;
    sort($mine);

    expect($keys)->toHaveCount(24)
        ->and($mine)->toBe($keys);
});

it('knows the type icons of the interface and no other', function () {
    expect(TypeIcon::isKnown('bug'))->toBeTrue()
        ->and(TypeIcon::isKnown('square'))->toBeFalse()
        ->and(TypeIcon::isKnown('Bug'))->toBeFalse();
});
