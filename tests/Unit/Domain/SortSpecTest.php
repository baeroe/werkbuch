<?php

use App\Domain\Filter\InvalidInput;
use App\Domain\Views\SortSpec;
use Tests\Support\FixedPropertyCatalog;

$refusal = function (callable $parse): array {
    try {
        $parse();
    } catch (InvalidInput $refused) {
        return $refused->errors;
    }

    return [];
};

it('parses a field and a direction', function (array $raw, string $field, bool $descending) {
    $sort = SortSpec::parse($raw, new FixedPropertyCatalog);

    expect($sort->field)->toBe($field)
        ->and($sort->descending)->toBe($descending)
        ->and($sort->toArray())->toBe($raw);
})->with([
    'due date descending' => [['field' => 'due_date', 'direction' => 'desc'], 'due_date', true],
    'the manual order' => [['field' => 'rank', 'direction' => 'asc'], 'rank', false],
    'the key' => [['field' => 'key', 'direction' => 'asc'], 'key', false],
    'the category' => [['field' => 'state_category', 'direction' => 'desc'], 'state_category', true],
    'a number property' => [['field' => 'property:effort', 'direction' => 'desc'], 'property:effort', true],
    'a date property' => [['field' => 'property:launch', 'direction' => 'asc'], 'property:launch', false],
    'a text property' => [['field' => 'property:browser', 'direction' => 'asc'], 'property:browser', false],
    'an address property' => [['field' => 'property:link', 'direction' => 'asc'], 'property:link', false],
]);

it('sorts by every core field', function () {
    foreach (SortSpec::CORE as $field) {
        expect(SortSpec::parse(['field' => $field, 'direction' => 'asc'], new FixedPropertyCatalog)->field)->toBe($field);
    }
});

it('reads -due_date from a query', function () {
    $catalog = new FixedPropertyCatalog;

    expect(SortSpec::fromQuery('-due_date', $catalog))->toEqual(new SortSpec('due_date', true))
        ->and(SortSpec::fromQuery('due_date', $catalog))->toEqual(new SortSpec('due_date', false))
        ->and(SortSpec::fromQuery('property:effort', $catalog))->toEqual(new SortSpec('property:effort', false))
        ->and(SortSpec::fromQuery('-property:effort', $catalog))->toEqual(new SortSpec('property:effort', true));
});

it('refuses a rich text property and an unknown field', function (mixed $raw) use ($refusal) {
    expect($refusal(fn () => SortSpec::parse($raw, new FixedPropertyCatalog)))->toBe(['' => 'invalid']);
})->with([
    'rich text' => [['field' => 'property:notes', 'direction' => 'asc']],
    'a choice' => [['field' => 'property:customer', 'direction' => 'asc']],
    'yes or no' => [['field' => 'property:approved', 'direction' => 'asc']],
    'people' => [['field' => 'property:reviewer', 'direction' => 'asc']],
    'an unknown property' => [['field' => 'property:gone', 'direction' => 'asc']],
    'an unknown field' => [['field' => 'title', 'direction' => 'asc']],
    'a field in capitals' => [['field' => 'Due_Date', 'direction' => 'asc']],
    'no field' => [['direction' => 'asc']],
    'a field that is no text' => [['field' => 7, 'direction' => 'asc']],
    'an unknown direction' => [['field' => 'due_date', 'direction' => 'down']],
    'no direction' => [['field' => 'due_date']],
    'an unknown key' => [['field' => 'due_date', 'direction' => 'asc', 'nulls' => 'first']],
    'no object' => ['due_date'],
    'a list' => [['due_date', 'asc']],
]);

it('refuses an unknown field in a query', function (string $raw) use ($refusal) {
    expect($refusal(fn () => SortSpec::fromQuery($raw, new FixedPropertyCatalog)))->toBe(['' => 'invalid']);
})->with(['title', '--due_date', '+due_date', '-property:notes', '', '-']);

it('falls back to the manual order for a stored unknown field', function () {
    $catalog = new FixedPropertyCatalog;

    expect(SortSpec::read(['field' => 'property:gone', 'direction' => 'desc'], $catalog))->toEqual(SortSpec::manual())
        ->and(SortSpec::read(['field' => 'due_date'], $catalog))->toEqual(SortSpec::manual())
        ->and(SortSpec::read(['field' => 'due_date', 'direction' => 'desc'], $catalog))->toEqual(new SortSpec('due_date', true))
        ->and(SortSpec::manual())->toEqual(new SortSpec('rank', false));
});

it('signs a sort with its field and direction', function () {
    expect((new SortSpec('due_date', true))->signature())->toBe('due_date:desc')
        ->and(SortSpec::manual()->signature())->toBe('rank:asc')
        ->and((new SortSpec('property:effort', false))->signature())->toBe('property:effort:asc');
});
