<?php

use App\Domain\Filter\Condition;
use App\Domain\Filter\CoreField;
use App\Domain\Filter\Field;
use App\Domain\Filter\FieldKind;
use App\Domain\Filter\Filter;
use App\Domain\Filter\FilterSchema;
use App\Domain\Filter\InvalidInput;
use App\Domain\Filter\Op;
use App\Domain\Filter\PropertyCatalog;
use App\Domain\Properties\FieldType;
use App\Domain\Properties\PropertyShape;
use Tests\Support\FixedPropertyCatalog;

$project = '01jbz8v6w2k7c0m9x4r5t3n8qa';
$other = '01jbz8v6w2k7c0m9x4r5t3n8qb';
$option = '01jbz8v6w2k7c0m9x4r5t3n8qc';

$catalog = fn (): PropertyCatalog => new FixedPropertyCatalog;

/** A filter of the conditions. */
$filter = fn (mixed ...$conditions): array => ['version' => 1, 'conditions' => $conditions];

/** The errors `parse` refuses the input with. */
$refusal = function (mixed $json, PropertyCatalog $catalog): array {
    try {
        FilterSchema::parse($json, $catalog);
    } catch (InvalidInput $refused) {
        return $refused->errors;
    }

    return [];
};

it('reads the sketch of the spec as five conditions', function () use ($catalog, $filter, $project, $option) {
    $json = $filter(
        ['field' => 'project', 'op' => 'in', 'value' => [$project]],
        ['field' => 'state_category', 'op' => 'in', 'value' => ['unstarted', 'started']],
        ['field' => 'assignee', 'op' => 'in', 'value' => ['me']],
        ['field' => 'due_date', 'op' => 'before', 'value' => ['relative' => '+7d']],
        ['field' => 'property:customer', 'op' => 'in', 'value' => [$option]],
    );

    $parsed = FilterSchema::parse($json, $catalog());

    expect($parsed->conditions)->toHaveCount(5)
        ->and(array_map(fn (Condition $c) => $c->resolved?->name, $parsed->conditions))
        ->toBe(['project', 'state_category', 'assignee', 'due_date', 'property:customer'])
        ->and($parsed->conditions[4]->resolved?->propertyKey)->toBe('customer')
        ->and($parsed->conditions[4]->resolved?->propertyType)->toBe(FieldType::Dropdown)
        ->and($parsed->conditions[2]->op)->toBe(Op::In)
        ->and($parsed->toArray())->toBe($json);
});

it('writes ULIDs in small letters and lists without doubles in the order sent', function () use ($catalog, $filter, $project, $other) {
    $parsed = FilterSchema::parse($filter(
        ['field' => 'project', 'op' => 'in', 'value' => [strtoupper($other), $project, $other]],
        ['field' => 'assignee', 'op' => 'is', 'value' => strtoupper($project)],
        ['field' => 'assignee', 'op' => 'not_in', 'value' => ['me', 'me']],
    ), $catalog());

    expect($parsed->toArray()['conditions'])->toBe([
        ['field' => 'project', 'op' => 'in', 'value' => [$other, $project]],
        ['field' => 'assignee', 'op' => 'is', 'value' => $project],
        ['field' => 'assignee', 'op' => 'not_in', 'value' => ['me']],
    ]);
});

/** Every form of value the schema takes, with its normal form; together they use every operator. */
$accepted = [
    'state category' => [['field' => 'state_category', 'op' => 'is', 'value' => 'started'], 'started'],
    'priorities' => [['field' => 'priority', 'op' => 'not_in', 'value' => ['none', 'low']], ['none', 'low']],
    'is with a list' => [['field' => 'type', 'op' => 'is', 'value' => ['01JBZ8V6W2K7C0M9X4R5T3N8QA']], ['01jbz8v6w2k7c0m9x4r5t3n8qa']],
    'created by me' => [['field' => 'created_by', 'op' => 'is', 'value' => 'me'], 'me'],
    'parent is empty' => [['field' => 'parent', 'op' => 'is_empty'], null],
    'label contains' => [['field' => 'label', 'op' => 'contains', 'value' => '01jbz8v6w2k7c0m9x4r5t3n8qa'], '01jbz8v6w2k7c0m9x4r5t3n8qa'],
    'a day' => [['field' => 'start_date', 'op' => 'is', 'value' => '2026-10-31'], '2026-10-31'],
    'today' => [['field' => 'due_date', 'op' => 'after', 'value' => 'today'], 'today'],
    'this week' => [['field' => 'created_at', 'op' => 'is', 'value' => 'this_week'], 'this_week'],
    'this month' => [['field' => 'updated_at', 'op' => 'before', 'value' => 'this_month'], 'this_month'],
    'between relative days' => [['field' => 'due_date', 'op' => 'between', 'value' => [['relative' => '0d'], ['relative' => '+1w']]], [['relative' => '0d'], ['relative' => '+1w']]],
    'closed at is not empty' => [['field' => 'closed_at', 'op' => 'is_not_empty'], null],
    'overdue' => [['field' => 'due_date', 'op' => 'overdue'], null],
    'overdue with a value of null' => [['field' => 'due_date', 'op' => 'overdue', 'value' => null], null],
    'a flag' => [['field' => 'blocked', 'op' => 'is', 'value' => false], false],
    'subscribed' => [['field' => 'subscribed', 'op' => 'is', 'value' => true], true],
    'title contains' => [['field' => 'title', 'op' => 'contains', 'value' => 'Login'], 'Login'],
    'a title of 255 characters' => [['field' => 'title', 'op' => 'contains', 'value' => str_repeat('ä', 255)], str_repeat('ä', 255)],
    'text property is' => [['field' => 'property:browser', 'op' => 'is', 'value' => 'Safari'], 'Safari'],
    'url property is empty' => [['field' => 'property:link', 'op' => 'is_empty'], null],
    'number gt' => [['field' => 'property:effort', 'op' => 'gt', 'value' => 1.5], 1.5],
    'number between' => [['field' => 'property:effort', 'op' => 'between', 'value' => [-2, 8]], [-2, 8]],
    'number just below the limit' => [['field' => 'property:effort', 'op' => 'lt', 'value' => 99999999999999983616.0], 99999999999999983616.0],
    'rich text contains' => [['field' => 'property:notes', 'op' => 'contains', 'value' => 'Safari'], 'Safari'],
    'yes or no' => [['field' => 'property:approved', 'op' => 'is', 'value' => false], false],
    'date property' => [['field' => 'property:launch', 'op' => 'before', 'value' => '2026-12-01'], '2026-12-01'],
    'single member is me' => [['field' => 'property:reviewer', 'op' => 'is', 'value' => 'me'], 'me'],
    'multiple members contain me' => [['field' => 'property:reviewers', 'op' => 'contains', 'value' => 'me'], 'me'],
    'multiple options' => [['field' => 'property:platforms', 'op' => 'in', 'value' => ['01jbz8v6w2k7c0m9x4r5t3n8qa']], ['01jbz8v6w2k7c0m9x4r5t3n8qa']],
    'archived' => [['field' => 'archived', 'op' => 'is', 'value' => true], true],
    'between one number' => [['field' => 'property:effort', 'op' => 'between', 'value' => [5, 5]], [5, 5]],
    'between one day' => [['field' => 'due_date', 'op' => 'between', 'value' => ['2026-10-01', '2026-10-01']], ['2026-10-01', '2026-10-01']],
    'between one relative day' => [['field' => 'created_at', 'op' => 'between', 'value' => [['relative' => '-7d'], ['relative' => '-7d']]], [['relative' => '-7d'], ['relative' => '-7d']]],
    'between reversed ends stays as sent' => [['field' => 'property:effort', 'op' => 'between', 'value' => [8, -2]], [8, -2]],
    'is not' => [['field' => 'state', 'op' => 'is_not', 'value' => '01JBZ8V6W2K7C0M9X4R5T3N8QA'], '01jbz8v6w2k7c0m9x4r5t3n8qa'],
    'in' => [['field' => 'assignee', 'op' => 'in', 'value' => ['me', '01jbz8v6w2k7c0m9x4r5t3n8qa']], ['me', '01jbz8v6w2k7c0m9x4r5t3n8qa']],
];

it('accepts every form of value the schema knows', function (array $condition, mixed $expected) use ($catalog, $filter) {
    $parsed = FilterSchema::parse($filter($condition), $catalog());

    expect($parsed->conditions[0]->value)->toBe($expected)
        ->and($parsed->conditions[0]->resolved)->not->toBeNull();
})->with($accepted);

it('reads a stored filter back as it parsed it, for every operator', function () use ($catalog, $filter, $accepted) {
    $ops = [];
    foreach ($accepted as $name => [$condition]) {
        $parsed = FilterSchema::parse($filter($condition), $catalog());

        expect(FilterSchema::read($parsed->toArray(), $catalog()))->toEqual($parsed, $name);
        $ops[] = $parsed->conditions[0]->op->value;
    }

    $all = array_map(fn (Op $op) => $op->value, Op::cases());
    sort($all);
    $ops = array_values(array_unique($ops));
    sort($ops);

    expect($ops)->toBe($all);
});

it('refuses a filter with the path and code of what is wrong', function (mixed $json, array $errors) use ($catalog, $refusal) {
    expect($refusal($json, $catalog()))->toBe($errors);
})->with([
    'no object' => ['state is started', ['' => 'shape']],
    'a list' => [[['field' => 'title']], ['' => 'shape']],
    'version 2' => [['version' => 2, 'conditions' => []], ['' => 'shape']],
    'version as text' => [['version' => '1', 'conditions' => []], ['' => 'shape']],
    'no version' => [['conditions' => []], ['' => 'shape']],
    'conditions no list' => [['version' => 1, 'conditions' => ['a' => []]], ['' => 'shape']],
    'an unknown key' => [['version' => 1, 'conditions' => [], 'sort' => []], ['' => 'shape']],
    'too many conditions' => [['version' => 1, 'conditions' => array_fill(0, 51, ['field' => 'archived', 'op' => 'is', 'value' => false])], ['conditions' => 'too_many']],
]);

it('refuses a condition with the path and code of what is wrong', function (mixed $condition, array $errors) use ($catalog, $filter, $refusal) {
    expect($refusal($filter(['field' => 'archived', 'op' => 'is', 'value' => false], $condition), $catalog()))->toBe($errors);
})->with([
    'no object' => ['archived', ['conditions.1' => 'shape']],
    'an unknown key' => [['field' => 'archived', 'op' => 'is', 'value' => false, 'not' => true], ['conditions.1' => 'shape']],
    'an unknown field' => [['field' => 'assignee_name', 'op' => 'is', 'value' => 'Lena'], ['conditions.1.field' => 'field']],
    'no field' => [['op' => 'is', 'value' => 'Lena'], ['conditions.1.field' => 'field']],
    'a field that is no text' => [['field' => 7, 'op' => 'is', 'value' => 'Lena'], ['conditions.1.field' => 'field']],
    'an unknown property' => [['field' => 'property:unknown', 'op' => 'is_empty'], ['conditions.1.field' => 'field']],
    'a property without a key' => [['field' => 'property:', 'op' => 'is_empty'], ['conditions.1.field' => 'field']],
    'an unknown operator' => [['field' => 'title', 'op' => 'starts_with', 'value' => 'a'], ['conditions.1.op' => 'operator']],
    'no operator' => [['field' => 'title', 'value' => 'a'], ['conditions.1.op' => 'operator']],
    'title is empty' => [['field' => 'title', 'op' => 'is_empty'], ['conditions.1.op' => 'operator']],
    'title is' => [['field' => 'title', 'op' => 'is', 'value' => 'Login'], ['conditions.1.op' => 'operator']],
    'overdue on the start date' => [['field' => 'start_date', 'op' => 'overdue'], ['conditions.1.op' => 'operator']],
    'overdue on a date property' => [['field' => 'property:launch', 'op' => 'overdue'], ['conditions.1.op' => 'operator']],
    'type is empty' => [['field' => 'type', 'op' => 'is_empty'], ['conditions.1.op' => 'operator']],
    'created at is empty' => [['field' => 'created_at', 'op' => 'is_empty'], ['conditions.1.op' => 'operator']],
    'yes or no is empty' => [['field' => 'property:approved', 'op' => 'is_empty'], ['conditions.1.op' => 'operator']],
    'a flag with in' => [['field' => 'blocked', 'op' => 'in', 'value' => [true]], ['conditions.1.op' => 'operator']],
    'state category contains' => [['field' => 'state_category', 'op' => 'contains', 'value' => 'started'], ['conditions.1.op' => 'operator']],
    'an unknown category' => [['field' => 'state_category', 'op' => 'in', 'value' => ['doing']], ['conditions.1.value' => 'value']],
    'a priority as a number' => [['field' => 'priority', 'op' => 'in', 'value' => [0]], ['conditions.1.value' => 'value']],
    'a priority in capitals' => [['field' => 'priority', 'op' => 'is', 'value' => 'High'], ['conditions.1.value' => 'value']],
    'a day in german' => [['field' => 'due_date', 'op' => 'before', 'value' => '31.10.2026'], ['conditions.1.value' => 'value']],
    'a day with a line break' => [['field' => 'due_date', 'op' => 'before', 'value' => "2026-10-31\n"], ['conditions.1.value' => 'value']],
    'no calendar day' => [['field' => 'due_date', 'op' => 'is', 'value' => '2026-02-30'], ['conditions.1.value' => 'value']],
    'months are no unit' => [['field' => 'due_date', 'op' => 'before', 'value' => ['relative' => '+7m']], ['conditions.1.value' => 'value']],
    'relative with a line break' => [['field' => 'due_date', 'op' => 'before', 'value' => ['relative' => "+7d\n"]], ['conditions.1.value' => 'value']],
    'relative and more' => [['field' => 'due_date', 'op' => 'before', 'value' => ['relative' => '+7d', 'from' => 'today']], ['conditions.1.value' => 'value']],
    'a list of days for is' => [['field' => 'due_date', 'op' => 'is', 'value' => ['2026-10-31']], ['conditions.1.value' => 'value']],
    'between one day' => [['field' => 'due_date', 'op' => 'between', 'value' => ['2026-10-01']], ['conditions.1.value' => 'value']],
    'between three days' => [['field' => 'due_date', 'op' => 'between', 'value' => ['2026-10-01', '2026-10-02', '2026-10-03']], ['conditions.1.value' => 'value']],
    'between with a wrong end' => [['field' => 'due_date', 'op' => 'between', 'value' => ['2026-10-01', 'tomorrow']], ['conditions.1.value' => 'value']],
    'between no list' => [['field' => 'property:effort', 'op' => 'between', 'value' => ['from' => 1, 'to' => 2]], ['conditions.1.value' => 'value']],
    'a number at the limit' => [['field' => 'property:effort', 'op' => 'gt', 'value' => 1e20], ['conditions.1.value' => 'value']],
    'a negative number at the limit' => [['field' => 'property:effort', 'op' => 'lt', 'value' => -1e20], ['conditions.1.value' => 'value']],
    'a number as text' => [['field' => 'property:effort', 'op' => 'is', 'value' => '5'], ['conditions.1.value' => 'value']],
    'a boolean as a number' => [['field' => 'property:effort', 'op' => 'is', 'value' => true], ['conditions.1.value' => 'value']],
    'no finite number' => [['field' => 'property:effort', 'op' => 'is', 'value' => INF], ['conditions.1.value' => 'value']],
    'a project of mine' => [['field' => 'project', 'op' => 'in', 'value' => ['me']], ['conditions.1.value' => 'value']],
    'me in capitals' => [['field' => 'assignee', 'op' => 'is', 'value' => 'ME'], ['conditions.1.value' => 'value']],
    'me as an option' => [['field' => 'property:customer', 'op' => 'is', 'value' => 'me'], ['conditions.1.value' => 'value']],
    'no ULID' => [['field' => 'assignee', 'op' => 'is', 'value' => 'lena'], ['conditions.1.value' => 'value']],
    'a ULID beyond its range' => [['field' => 'assignee', 'op' => 'is', 'value' => '81jbz8v6w2k7c0m9x4r5t3n8qa'], ['conditions.1.value' => 'value']],
    'a ULID with a line break' => [['field' => 'assignee', 'op' => 'is', 'value' => "01jbz8v6w2k7c0m9x4r5t3n8qa\n"], ['conditions.1.value' => 'value']],
    'a ULID with an i' => [['field' => 'assignee', 'op' => 'is', 'value' => '01jbz8v6w2k7c0m9x4r5t3n8qi'], ['conditions.1.value' => 'value']],
    'is empty with a value' => [['field' => 'due_date', 'op' => 'is_empty', 'value' => '2026-10-31'], ['conditions.1.value' => 'value']],
    'overdue with a value' => [['field' => 'due_date', 'op' => 'overdue', 'value' => 'today'], ['conditions.1.value' => 'value']],
    'no value' => [['field' => 'due_date', 'op' => 'before'], ['conditions.1.value' => 'value']],
    'a value of null' => [['field' => 'assignee', 'op' => 'is', 'value' => null], ['conditions.1.value' => 'value']],
    'in without a list' => [['field' => 'project', 'op' => 'in', 'value' => $project], ['conditions.1.value' => 'value']],
    'in with an empty list' => [['field' => 'project', 'op' => 'in', 'value' => []], ['conditions.1.value' => 'value']],
    'in with an object' => [['field' => 'project', 'op' => 'in', 'value' => ['a' => $project]], ['conditions.1.value' => 'value']],
    'in with 101 values' => [['field' => 'label', 'op' => 'in', 'value' => array_fill(0, 101, $project)], ['conditions.1.value' => 'value']],
    'in with one value of a wrong form' => [['field' => 'label', 'op' => 'in', 'value' => [$project, 7]], ['conditions.1.value' => 'value']],
    'contains nothing' => [['field' => 'title', 'op' => 'contains', 'value' => ''], ['conditions.1.value' => 'value']],
    'contains blanks' => [['field' => 'property:notes', 'op' => 'contains', 'value' => '   '], ['conditions.1.value' => 'value']],
    'contains too much' => [['field' => 'title', 'op' => 'contains', 'value' => str_repeat('a', 256)], ['conditions.1.value' => 'value']],
    'contains a number' => [['field' => 'title', 'op' => 'contains', 'value' => 7], ['conditions.1.value' => 'value']],
    'a flag as text' => [['field' => 'archived', 'op' => 'is', 'value' => 'true'], ['conditions.1.value' => 'value']],
    'a flag as a list' => [['field' => 'archived', 'op' => 'is', 'value' => [true]], ['conditions.1.value' => 'value']],
]);

it('names every condition that is wrong in one refusal', function () use ($catalog, $filter, $refusal) {
    expect($refusal($filter(
        ['field' => 'assignee_name', 'op' => 'is', 'value' => 'Lena'],
        ['field' => 'archived', 'op' => 'is', 'value' => false],
        ['field' => 'title', 'op' => 'is_empty'],
        ['field' => 'due_date', 'op' => 'before', 'value' => '31.10.2026'],
    ), $catalog()))->toBe([
        'conditions.0.field' => 'field',
        'conditions.2.op' => 'operator',
        'conditions.3.value' => 'value',
    ]);
});

it('takes fifty conditions', function () use ($catalog) {
    $json = ['version' => 1, 'conditions' => array_fill(0, 50, ['field' => 'archived', 'op' => 'is', 'value' => false])];

    expect(FilterSchema::parse($json, $catalog())->conditions)->toHaveCount(50);
});

it('takes a list of a hundred values', function () use ($catalog, $filter) {
    $ids = array_map(fn (int $n) => '01jbz8v6w2k7c0m9x4r5t3n'.sprintf('%03d', $n), range(100, 199));

    expect(FilterSchema::parse($filter(['field' => 'label', 'op' => 'in', 'value' => $ids]), $catalog())->conditions[0]->value)->toBe($ids);
});

it('reads a stored filter whose property is gone as one that matches nothing', function () use ($catalog, $filter, $project) {
    $read = FilterSchema::read($filter(
        ['field' => 'property:gone', 'op' => 'is', 'value' => 'x'],
        ['field' => 'project', 'op' => 'in', 'value' => [strtoupper($project)]],
        ['field' => 'state_category', 'op' => 'in', 'value' => ['doing']],
        ['field' => 'title', 'op' => 'starts_with', 'value' => 'a'],
        'archived',
    ), $catalog());

    expect($read->conditions)->toHaveCount(5)
        ->and($read->conditions[0])->toEqual(new Condition('property:gone', Op::Is, 'x', null))
        ->and($read->conditions[1]->resolved?->name)->toBe('project')
        ->and($read->conditions[1]->value)->toBe([$project])
        // a value that does not fit matches nothing either
        ->and($read->conditions[2]->resolved)->toBeNull()
        ->and($read->conditions[2]->value)->toBe(['doing'])
        // an operator it does not know stands as `is`, but matches nothing
        ->and($read->conditions[3])->toEqual(new Condition('title', Op::Is, 'a', null))
        ->and($read->conditions[4])->toEqual(new Condition('', Op::Is, null, null));
});

it('reads a stored filter of another form as one that matches nothing', function (array $stored) use ($catalog) {
    expect(FilterSchema::read($stored, $catalog())->conditions)->toEqual([new Condition('', Op::Is, null, null)]);
})->with([
    'version 2' => [['version' => 2, 'conditions' => []]],
    'no conditions' => [['version' => 1]],
]);

it('reads a stored empty filter as one that matches everything', function () use ($catalog) {
    expect(FilterSchema::read(Filter::empty()->toArray(), $catalog())->conditions)->toBe([]);
});

it('lists the named projects only from is and in', function () use ($catalog, $filter, $project, $other, $option) {
    $parsed = FilterSchema::parse($filter(
        ['field' => 'project', 'op' => 'in', 'value' => [$project, $other]],
        ['field' => 'project', 'op' => 'is', 'value' => strtoupper($project)],
        ['field' => 'project', 'op' => 'is', 'value' => [$option]],
        ['field' => 'project', 'op' => 'not_in', 'value' => ['01jbz8v6w2k7c0m9x4r5t3n8qd']],
        ['field' => 'project', 'op' => 'is_not', 'value' => '01jbz8v6w2k7c0m9x4r5t3n8qe'],
        ['field' => 'type', 'op' => 'is', 'value' => '01jbz8v6w2k7c0m9x4r5t3n8qf'],
    ), $catalog());
    $unresolved = FilterSchema::read($filter(['field' => 'project', 'op' => 'in', 'value' => ['me']]), $catalog());

    expect($parsed->namedProjects())->toBe([$project, $other, $option])
        ->and($unresolved->namedProjects())->toBe([])
        ->and(Filter::empty()->namedProjects())->toBe([]);
});

it('joins two filters and knows the fields they mention', function () use ($catalog, $filter, $project) {
    $view = FilterSchema::parse($filter(['field' => 'project', 'op' => 'is', 'value' => $project]), $catalog());
    $more = FilterSchema::parse($filter(['field' => 'archived', 'op' => 'is', 'value' => false]), $catalog());
    $joined = $view->and($more);

    expect($joined->conditions)->toBe([...$view->conditions, ...$more->conditions])
        ->and($joined->mentions('project'))->toBeTrue()
        ->and($joined->mentions('archived'))->toBeTrue()
        ->and($joined->mentions('assignee'))->toBeFalse()
        ->and($view->mentions('archived'))->toBeFalse()
        ->and(Filter::empty()->and($view))->toEqual($view)
        ->and(Filter::empty()->toArray())->toBe(['version' => 1, 'conditions' => []]);
});

it('gives the refused paths under the prefix of the caller', function () {
    $refused = new InvalidInput(['' => 'shape', 'conditions.0.op' => 'operator']);

    expect($refused->errorsAt('filter'))->toBe(['filter' => 'shape', 'filter.conditions.0.op' => 'operator'])
        ->and($refused->errorsAt('filters.open'))->toBe(['filters.open' => 'shape', 'filters.open.conditions.0.op' => 'operator'])
        ->and($refused->getMessage())->toBe('The input does not fit its schema: , conditions.0.op');
});

it('describes the core fields and the properties as conditions see them', function () use ($catalog) {
    $assignee = Field::core(CoreField::Assignee);
    $members = Field::named('property:reviewers', $catalog());

    expect($assignee->name)->toBe('assignee')
        ->and($assignee->kind)->toBe(FieldKind::Id)
        ->and($assignee->nullable)->toBeTrue()
        ->and($assignee->acceptsMe)->toBeTrue()
        ->and($assignee->propertyKey)->toBeNull()
        ->and($assignee->propertyType)->toBeNull()
        ->and($members?->name)->toBe('property:reviewers')
        ->and($members?->kind)->toBe(FieldKind::List)
        ->and($members?->acceptsMe)->toBeTrue()
        ->and($members?->propertyKey)->toBe('reviewers')
        ->and($members?->propertyType)->toBe(FieldType::Member)
        ->and(Field::named('created_by', $catalog()))->toEqual(Field::core(CoreField::CreatedBy))
        ->and(Field::named('property:gone', $catalog()))->toBeNull()
        ->and(Field::named('assignee_name', $catalog()))->toBeNull()
        ->and(count(CoreField::cases()))->toBe(21)
        ->and(array_map(fn (CoreField $f) => $f->value, array_values(array_filter(CoreField::cases(), fn (CoreField $f) => $f->nullable()))))
        ->toBe(['assignee', 'parent', 'label', 'start_date', 'due_date', 'closed_at'])
        ->and(array_map(fn (CoreField $f) => $f->value, array_values(array_filter(CoreField::cases(), fn (CoreField $f) => $f->acceptsMe()))))
        ->toBe(['assignee', 'created_by']);
});

/*
 * The operators of every field, as the filter bar has to offer them (K33). Task 16 moves this table into
 * `resources/js/features/items/filter/operators.json`, which the browser and this test then both read.
 */
$operators = [
    'core' => [
        'project' => ['is', 'is_not', 'in', 'not_in'],
        'type' => ['is', 'is_not', 'in', 'not_in'],
        'state' => ['is', 'is_not', 'in', 'not_in'],
        'assignee' => ['is', 'is_not', 'in', 'not_in', 'is_empty', 'is_not_empty'],
        'created_by' => ['is', 'is_not', 'in', 'not_in'],
        'parent' => ['is', 'is_not', 'in', 'not_in', 'is_empty', 'is_not_empty'],
        'state_category' => ['is', 'is_not', 'in', 'not_in'],
        'priority' => ['is', 'is_not', 'in', 'not_in'],
        'label' => ['is', 'is_not', 'in', 'not_in', 'is_empty', 'is_not_empty', 'contains'],
        'start_date' => ['is', 'before', 'after', 'between', 'is_empty', 'is_not_empty'],
        'due_date' => ['is', 'before', 'after', 'between', 'is_empty', 'is_not_empty', 'overdue'],
        'created_at' => ['is', 'before', 'after', 'between'],
        'updated_at' => ['is', 'before', 'after', 'between'],
        'closed_at' => ['is', 'before', 'after', 'between', 'is_empty', 'is_not_empty'],
        'has_children' => ['is'],
        'blocked' => ['is'],
        'blocking' => ['is'],
        'archived' => ['is'],
        'epic' => ['is'],
        'subscribed' => ['is'],
        'title' => ['contains'],
    ],
    'property' => [
        'dropdown' => ['is', 'is_not', 'in', 'not_in', 'is_empty', 'is_not_empty'],
        'dropdown_multiple' => ['is', 'is_not', 'in', 'not_in', 'is_empty', 'is_not_empty', 'contains'],
        'member' => ['is', 'is_not', 'in', 'not_in', 'is_empty', 'is_not_empty'],
        'member_multiple' => ['is', 'is_not', 'in', 'not_in', 'is_empty', 'is_not_empty', 'contains'],
        'date' => ['is', 'before', 'after', 'between', 'is_empty', 'is_not_empty'],
        'boolean' => ['is'],
        'number' => ['is', 'gt', 'lt', 'between', 'is_empty', 'is_not_empty'],
        'text' => ['contains', 'is', 'is_empty', 'is_not_empty'],
        'url' => ['contains', 'is', 'is_empty', 'is_not_empty'],
        'rich_text' => ['contains', 'is_empty', 'is_not_empty'],
    ],
];

it('offers the operators of every core field and every type of property', function () use ($operators) {
    $names = fn (Field $field): array => array_map(fn (Op $op) => $op->value, $field->ops());

    $core = [];
    foreach (CoreField::cases() as $field) {
        $core[$field->value] = $names(Field::core($field));
    }

    $property = [];
    foreach (FieldType::cases() as $type) {
        $property[$type->value] = $names(Field::property('x', new PropertyShape($type, 0, false, [])));
        if ($type->allowsMultiple()) {
            $property[$type->value.'_multiple'] = $names(Field::property('x', new PropertyShape($type, 0, true, [])));
        }
    }

    $expected = $operators['property'];
    ksort($property);
    ksort($expected);

    expect($core)->toBe($operators['core'])
        ->and($property)->toBe($expected);
});
