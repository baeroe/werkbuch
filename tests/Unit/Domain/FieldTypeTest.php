<?php

use App\Domain\Properties\FieldType;

/** The field types for which the method is true, in the order of the enum. */
$fieldTypesWhere = fn (string $method) => array_values(array_map(
    fn (FieldType $type) => $type->value,
    array_filter(FieldType::cases(), fn (FieldType $type) => $type->{$method}()),
));

it('has options for dropdowns only', function () use ($fieldTypesWhere) {
    expect($fieldTypesWhere('hasOptions'))->toBe(['dropdown']);
});

it('allows several values for dropdowns and members', function () use ($fieldTypesWhere) {
    expect($fieldTypesWhere('allowsMultiple'))->toBe(['dropdown', 'member']);
});

it('has decimals for numbers only', function () use ($fieldTypesWhere) {
    expect($fieldTypesWhere('hasDecimals'))->toBe(['number']);
});

it('has a default for every type except members and rich text', function () use ($fieldTypesWhere) {
    expect($fieldTypesWhere('hasDefault'))->toBe(['text', 'number', 'dropdown', 'boolean', 'date', 'url']);
});
