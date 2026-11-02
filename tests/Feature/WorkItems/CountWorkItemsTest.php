<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\CountWorkItems;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Illuminate\Validation\ValidationException;

/*
 * `CountWorkItems`: named filters counted in one call, every number through ItemQuery (only what the reader sees,
 * P18), `include_archived` for all of them.
 */

/** WEB (public) with Mara as member, the private OPS without her. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Member)->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();

    return [$mara, $web, $ops];
};

/** The field errors of a call, path → first sentence. */
$errors = function (Closure $call): array {
    try {
        $call();
    } catch (ValidationException $e) {
        return array_map(fn (array $messages) => $messages[0], $e->errors());
    }
    throw new RuntimeException('no ValidationException');
};

$filter = fn (array ...$conditions): array => ['version' => 1, 'conditions' => array_values($conditions)];

it('counts named filters in one call', function () use ($world, $filter) {
    [$mara, $web] = $world();
    $bug = WorkItemType::query()->where('name', 'Bug')->sole();
    WorkItem::factory()->for($web)->count(3)->create(['type_id' => $bug->id]);
    WorkItem::factory()->for($web)->count(9)->create();
    WorkItem::factory()->for($web)->closed()->count(2)->create();

    expect(CountWorkItems::run(actor($mara), ['filters' => [
        'bugs' => $filter(['field' => 'type', 'op' => 'is', 'value' => $bug->id]),
        'open' => $filter(['field' => 'state_category', 'op' => 'not_in', 'value' => ['completed', 'canceled']]),
    ]]))->toBe(['bugs' => 3, 'open' => 12]);
});

it('counts archived items with include_archived', function () use ($world, $filter) {
    [$mara, $web] = $world();
    WorkItem::factory()->for($web)->create();
    WorkItem::factory()->for($web)->archived()->create();
    $archivedProject = Project::factory()->public()->archived()->create();
    WorkItem::factory()->for($archivedProject)->create();
    $body = fn (array $more = []) => ['filters' => ['all' => $filter()], ...$more];

    expect(CountWorkItems::run(actor($mara), $body()))->toBe(['all' => 1])
        ->and(CountWorkItems::run(actor($mara), $body(['include_archived' => true])))->toBe(['all' => 3])
        ->and(CountWorkItems::run(actor($mara), $body(['include_archived' => '0'])))->toBe(['all' => 1])
        // the cards of the projects (K11): items of archived projects, but no archived items
        ->and(CountWorkItems::run(actor($mara), ['filters' => ['open' => $filter(['field' => 'archived', 'op' => 'is', 'value' => false])], 'include_archived' => true]))
        ->toBe(['open' => 2]);
});

it('counts only what the reader sees', function () use ($world, $filter) {
    [$mara, $web, $ops] = $world();
    WorkItem::factory()->for($web)->create();
    WorkItem::factory()->for($ops)->count(2)->create();

    // a filter on the hidden project counts 0, never 404
    expect(CountWorkItems::run(actor($mara), ['filters' => [
        'all' => $filter(),
        'ops' => $filter(['field' => 'project', 'op' => 'is', 'value' => $ops->id]),
    ], 'include_archived' => true]))->toBe(['all' => 1, 'ops' => 0]);
});

it('refuses more than 50 filters and a bad name', function () use ($world, $errors, $filter) {
    [$mara] = $world();
    $many = [];
    foreach (range(1, 51) as $n) {
        $many["f{$n}"] = $filter();
    }
    $invalid = __('field.filters.invalid', ['max' => 50]);
    $fifty = array_slice($many, 0, 50);

    expect($errors(fn () => CountWorkItems::run(actor($mara), ['filters' => $many])))->toBe(['filters' => $invalid])
        ->and(CountWorkItems::run(actor($mara), ['filters' => $fifty]))->toHaveCount(50)
        ->and($errors(fn () => CountWorkItems::run(actor($mara), [])))->toBe(['filters' => $invalid])
        ->and($errors(fn () => CountWorkItems::run(actor($mara), ['filters' => []])))->toBe(['filters' => $invalid])
        ->and($errors(fn () => CountWorkItems::run(actor($mara), ['filters' => [$filter()]])))->toBe(['filters' => $invalid])
        ->and($errors(fn () => CountWorkItems::run(actor($mara), ['filters' => 'all'])))->toBe(['filters' => $invalid])
        ->and($errors(fn () => CountWorkItems::run(actor($mara), ['filters' => ['open items' => $filter()]])))
        ->toBe(['filters' => __('field.filters.name', ['name' => 'open items'])])
        ->and($errors(fn () => CountWorkItems::run(actor($mara), ['filters' => [str_repeat('a', 65) => $filter()]])))->toHaveKey('filters')
        ->and(CountWorkItems::run(actor($mara), ['filters' => [str_repeat('a', 64) => $filter(), 'Type:Bug.open-1_x' => $filter()]]))->toHaveCount(2)
        ->and($errors(fn () => CountWorkItems::run(actor($mara), ['filters' => ['all' => $filter()], 'group_by' => 'state', 'include_archived' => 'yes'])))
        ->toBe(['group_by' => __('field.query.unknown', ['keys' => 'filters, include_archived']), 'include_archived' => __('field.include_archived.invalid')]);
});

it('names the condition that is wrong', function () use ($world, $errors, $filter) {
    [$mara] = $world();

    expect($errors(fn () => CountWorkItems::run(actor($mara), ['filters' => [
        'open' => $filter(['field' => 'state_category', 'op' => 'in', 'value' => ['opened']]),
        'mine' => $filter(['field' => 'assignee', 'op' => 'is', 'value' => 'me'], ['field' => 'nope', 'op' => 'is', 'value' => 1]),
        'odd' => 'all',
    ]])))->toBe([
        'filters.open.conditions.0.value' => __('field.filter.value'),
        'filters.mine.conditions.1.field' => __('field.filter.field'),
        'filters.odd' => __('field.filter.shape'),
    ]);
});
