<?php

use App\Domain\Filter\InvalidInput;
use App\Domain\Views\Display;
use App\Domain\Views\DisplaySchema;
use App\Domain\Views\GroupBy;
use App\Domain\Views\Layout;
use App\Domain\Views\SortSpec;
use Tests\Support\FixedPropertyCatalog;

/** The display of the board "Sprint-Board" with the fields given. */
$board = fn (array $fields = ['key', 'title', 'assignee', 'property:customer']): array => [
    'layout' => 'board',
    'group_by' => 'state',
    'sort' => ['field' => 'priority', 'direction' => 'asc'],
    'fields' => $fields,
    'show_sub_items' => false,
];

$refusal = function (mixed $raw): array {
    try {
        DisplaySchema::parse($raw, new FixedPropertyCatalog);
    } catch (InvalidInput $refused) {
        return $refused->errors;
    }

    return [];
};

it('parses the display of a view', function () use ($board) {
    $display = DisplaySchema::parse($board(), new FixedPropertyCatalog);

    expect($display->layout)->toBe(Layout::Board)
        ->and($display->groupBy)->toBe(GroupBy::State)
        ->and($display->sort)->toEqual(new SortSpec('priority', false))
        ->and($display->fields)->toBe(['key', 'title', 'assignee', 'property:customer'])
        ->and($display->showSubItems)->toBeFalse()
        ->and($display->toArray())->toBe($board());
});

it('takes every field a row can show and every property, once each in the order sent', function () use ($board) {
    $fields = [...DisplaySchema::FIELDS, 'property:notes', 'property:approved', 'key', 'property:notes'];

    expect(DisplaySchema::parse($board($fields), new FixedPropertyCatalog)->fields)
        ->toBe([...DisplaySchema::FIELDS, 'property:notes', 'property:approved'])
        ->and(DisplaySchema::parse($board([]), new FixedPropertyCatalog)->fields)->toBe([]);
});

it('takes thirty fields', function () use ($board) {
    $fields = array_map(fn (int $n) => DisplaySchema::FIELDS[$n % 11], range(0, 29));

    expect(DisplaySchema::parse($board($fields), new FixedPropertyCatalog)->fields)->toBe(DisplaySchema::FIELDS);
});

it('refuses an unknown layout, grouping or field and too many fields', function (array $change, array $errors) use ($board, $refusal) {
    expect($refusal([...$board(), ...$change]))->toBe($errors);
})->with([
    'an unknown layout' => [['layout' => 'gantt'], ['layout' => 'invalid']],
    'an unknown grouping' => [['group_by' => 'milestone'], ['group_by' => 'invalid']],
    'a grouping that is no text' => [['group_by' => null], ['group_by' => 'invalid']],
    'an unknown sort' => [['sort' => ['field' => 'title', 'direction' => 'asc']], ['sort' => 'invalid']],
    'an unknown field' => [['fields' => ['key', 'estimate']], ['fields.1' => 'invalid']],
    'an unknown property' => [['fields' => ['property:gone']], ['fields.0' => 'invalid']],
    'a field that is no text' => [['fields' => ['key', 7]], ['fields.1' => 'invalid']],
    'fields no list' => [['fields' => ['a' => 'key']], ['fields' => 'invalid']],
    'too many fields' => [['fields' => array_fill(0, 31, 'key')], ['fields' => 'too_many']],
    'sub items as text' => [['show_sub_items' => 'yes'], ['show_sub_items' => 'invalid']],
    'everything at once' => [
        ['layout' => 'gantt', 'group_by' => 'milestone', 'sort' => 'rank', 'fields' => ['estimate'], 'show_sub_items' => 1],
        ['layout' => 'invalid', 'group_by' => 'invalid', 'sort' => 'invalid', 'fields.0' => 'invalid', 'show_sub_items' => 'invalid'],
    ],
]);

it('refuses a display that misses a part or has more', function (mixed $raw, array $errors) use ($refusal) {
    expect($refusal($raw))->toBe($errors);
})->with([
    'no object' => ['board', ['' => 'shape']],
    'a list' => [['board', 'state'], ['' => 'shape']],
    'an unknown key' => [[...$board(), 'density' => 'compact'], ['' => 'shape']],
    'nothing' => [[], ['layout' => 'invalid', 'group_by' => 'invalid', 'sort' => 'invalid', 'fields' => 'invalid', 'show_sub_items' => 'invalid']],
    'no fields' => [array_diff_key($board(), ['fields' => true]), ['fields' => 'invalid']],
]);

it('drops unknown fields of a stored display', function () use ($board) {
    $stored = $board(['key', 'estimate', 'property:gone', 7, 'property:customer', 'key']);

    expect(DisplaySchema::read($stored, new FixedPropertyCatalog))
        ->toEqual(new Display(Layout::Board, GroupBy::State, new SortSpec('priority', false), ['key', 'property:customer'], false));
});

it('reads what it cannot use of a stored display as the plain list', function () {
    expect(DisplaySchema::read(['layout' => 'gantt', 'group_by' => 'milestone', 'sort' => ['field' => 'property:gone', 'direction' => 'asc'], 'fields' => 'key', 'show_sub_items' => 'yes'], new FixedPropertyCatalog))
        ->toEqual(new Display(Layout::List, GroupBy::None, SortSpec::manual(), DisplaySchema::DEFAULT_FIELDS, true))
        ->and(DisplaySchema::read([], new FixedPropertyCatalog))
        ->toEqual(new Display(Layout::List, GroupBy::None, SortSpec::manual(), DisplaySchema::DEFAULT_FIELDS, true))
        ->and(DisplaySchema::read(['fields' => ['a' => 'key']], new FixedPropertyCatalog)->fields)
        ->toBe(DisplaySchema::DEFAULT_FIELDS);
});

it('keeps an empty list of fields as the empty list: only a stored non-list takes the default', function () {
    expect(DisplaySchema::read(['fields' => []], new FixedPropertyCatalog)->fields)->toBe([]);
});

it('takes the default fields of the browser (T2-M1)', function () {
    preg_match('/export const DEFAULT_FIELDS = \[(.*?)\];/', (string) file_get_contents(repo_path('resources/js/domain/viewState.ts')), $match);

    expect(array_map(fn (string $field): string => trim($field, " '"), explode(',', $match[1])))->toBe(DisplaySchema::DEFAULT_FIELDS);
});
