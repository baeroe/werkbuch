<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\ListWorkItems;
use App\Actions\WorkItems\QueryWorkItems;
use App\Domain\Filter\FilterSchema;
use App\Exceptions\Problem;
use App\Models\Label;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Support\ListResult;
use App\Views\CatalogProperties;
use App\Views\ItemQueryInput;
use App\Views\Shorthand;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/** WEB (public) with Mara as its member, and the private OPS she is no member of. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Member)->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();

    return [$web, $ops, $mara];
};

/**
 * The keys of a page, in its order.
 *
 * @param  ListResult<WorkItem>  $result
 * @return list<string>
 */
$keys = fn (ListResult $result): array => array_values(array_map(fn (WorkItem $item) => $item->key, $result->page->items()));

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

it('answers 422 for an unknown key of the body at that key', function () use ($world, $errors) {
    [, , $mara] = $world();
    $unknown = __('field.query.unknown', ['keys' => implode(', ', ItemQueryInput::BODY_KEYS)]);

    // the keys of the groups and the counts are no keys of a page
    expect($errors(fn () => QueryWorkItems::run(actor($mara), ['filters' => [], 'groups' => 'state', 'include' => 'children'])))
        ->toBe(['filters' => $unknown, 'groups' => $unknown, 'include' => $unknown])
        ->and($errors(fn () => QueryWorkItems::run(actor($mara), [0 => 'x'])))->toBe(['0' => $unknown]);
});

it('names every field error of the body in one answer', function () use ($world, $errors, $filter) {
    [, , $mara] = $world();

    expect($errors(fn () => QueryWorkItems::run(actor($mara), [
        'filter' => $filter(['field' => 'title', 'op' => 'is', 'value' => 'x']),
        'sort' => ['field' => 'title', 'direction' => 'asc'],
        'shorthand' => ['assignee' => 'someone', 'archived' => 'yes', 'q' => 'Formular'],
        'q' => 'Formular',
        'show_sub_items' => 'no',
        'include_archived' => 2,
        'lean' => 'true',
        'per_page' => 0,
    ])))->toBe([
        'show_sub_items' => __('field.boolean'),
        'include_archived' => __('field.include_archived.invalid'),
        'lean' => __('field.boolean'),
        'filter.conditions.0.op' => __('field.filter.operator'),
        'sort' => __('field.sort.invalid'),
        'shorthand.assignee' => __('field.filter.value'),
        'shorthand.archived' => __('field.boolean'),
        'per_page' => __('validation.between.numeric', ['attribute' => 'per page', 'min' => 1, 'max' => 100]),
    ])
        ->and($errors(fn () => QueryWorkItems::run(actor($mara), ['q' => 5, 'filter' => 'x', 'shorthand' => 'WEB'])))->toBe([
            'q' => __('field.query.text'),
            'filter' => __('field.filter.shape'),
            'shorthand' => __('field.filter.invalid', ['keys' => implode(', ', Shorthand::KEYS)]),
        ])
        ->and($errors(fn () => QueryWorkItems::run(actor($mara), ['q' => 'Formular', 'shorthand' => ['q' => 'Formular']])))
        ->toBe(['q' => __('field.query.q_twice')])
        ->and($errors(fn () => QueryWorkItems::run(actor($mara), ['shorthand' => ['assignee' => ['me'], 'projekt' => 'WEB']])))
        ->toBe(['shorthand' => __('field.filter.invalid', ['keys' => implode(', ', Shorthand::KEYS)])])
        // `null` is a key left out
        ->and(QueryWorkItems::run(actor($mara), ['view_id' => null, 'filter' => null, 'sort' => null, 'q' => null, 'lean' => null])->total)->toBe(0);
});

it('answers 404 for an unknown view', function () use ($world) {
    [, , $mara] = $world();

    foreach ([(string) Str::ulid(), 'v_due_week', 5, ['id' => 'x']] as $ref) {
        expect(fn () => QueryWorkItems::run(actor($mara), ['view_id' => $ref]))
            ->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404));
        expect(fn () => ListWorkItems::run(actor($mara), ['view' => $ref]))
            ->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404));
    }
});

it('answers 404 for a short-form project or parent the account does not see', function () use ($world) {
    [, $ops, $mara] = $world();
    $hidden = WorkItem::factory()->for($ops)->epic()->create();

    foreach ([['project' => 'OPS'], ['project' => 'NOPE'], ['parent' => $hidden->id], ['parent' => 'OPS-1'], ['parent' => 'WEB-9']] as $shorthand) {
        expect(fn () => QueryWorkItems::run(actor($mara), ['shorthand' => $shorthand]))
            ->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404));
    }
});

it('reads every key of the shorthand into the conditions of the long form', function () use ($world, $filter) {
    [$web, , $mara] = $world();
    $epic = WorkItem::factory()->for($web)->epic()->create();
    $task = WorkItemType::query()->where('name', 'Task')->sole();
    $bug = WorkItemType::query()->where('name', 'Bug')->sole();
    $todo = WorkflowState::query()->where('workflow_id', Workflow::default()->id)->where('name', 'Todo')->sole();
    $ux = Label::factory()->create(['name' => 'UX']);
    $catalog = app(CatalogProperties::class);

    $read = Shorthand::read([
        'project' => 'web', 'parent' => 'WEB-1', 'q' => '  Formular ', 'assignee' => 'none',
        'created_by' => "me, {$mara->id}", 'type' => strtoupper($task->id).",{$bug->id}", 'state' => $todo->id,
        'state_category' => 'unstarted,started', 'priority' => 'urgent', 'label' => $ux->id, 'archived' => 'false',
    ], actor($mara));

    expect($read['q'])->toBe('Formular')
        ->and($read['conditions'])->toEqual(FilterSchema::parse($filter(
            ['field' => 'project', 'op' => 'is', 'value' => $web->id],
            ['field' => 'parent', 'op' => 'is', 'value' => $epic->id],
            ['field' => 'assignee', 'op' => 'is_empty'],
            ['field' => 'created_by', 'op' => 'in', 'value' => ['me', $mara->id]],
            ['field' => 'type', 'op' => 'in', 'value' => [$task->id, $bug->id]],
            ['field' => 'state', 'op' => 'in', 'value' => [$todo->id]],
            ['field' => 'state_category', 'op' => 'in', 'value' => ['unstarted', 'started']],
            ['field' => 'priority', 'op' => 'in', 'value' => ['urgent']],
            ['field' => 'label', 'op' => 'in', 'value' => [$ux->id]],
            ['field' => 'archived', 'op' => 'is', 'value' => false],
        ), $catalog)->conditions)
        // an empty value is no condition, `true` is the other flag
        ->and(Shorthand::read(['assignee' => '', 'q' => null, 'archived' => 'true'], actor($mara))['conditions'])
        ->toEqual(FilterSchema::parse($filter(['field' => 'archived', 'op' => 'is', 'value' => true]), $catalog)->conditions)
        // `none` only alone, and only for a field that can be empty
        ->and(fn () => Shorthand::read(['assignee' => 'none,me', 'created_by' => 'none', 'state' => 'Todo'], actor($mara)))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toBe([
            'filter.assignee' => [__('field.filter.value')],
            'filter.created_by' => [__('field.filter.operator')],
            'filter.state' => [__('field.filter.value')],
        ]));
});

it('pages through a view with its sort', function () use ($world, $keys) {
    [$web, , $mara] = $world();
    foreach (['2026-11-03', '2026-11-01', null, '2026-11-02', '2026-10-31'] as $due) {
        WorkItem::factory()->for($web)->create(['due_date' => $due]);
    }
    $view = View::factory()->create(['display' => [
        'layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'due_date', 'direction' => 'desc'], 'fields' => [], 'show_sub_items' => true,
    ]]);

    $pages = [];
    $cursor = null;
    do {
        $result = QueryWorkItems::run(actor($mara), ['view_id' => $view->id, 'per_page' => 2, 'cursor' => $cursor]);
        $pages[] = $keys($result);
        $cursor = $result->page->nextCursor()?->encode();
    } while ($cursor !== null);

    expect($pages)->toBe([['WEB-1', 'WEB-4'], ['WEB-2', 'WEB-5'], ['WEB-3']])
        // the cursor belongs to the sort of the view: another sort refuses it
        ->and(fn () => QueryWorkItems::run(actor($mara), ['per_page' => 2, 'cursor' => QueryWorkItems::run(actor($mara), ['view_id' => $view->id, 'per_page' => 2])->page->nextCursor()?->encode()]))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toBe(['cursor' => [__('field.cursor.invalid')]]));
});

it('sorts by key and category next to the archive rules and a condition on created_at', function () use ($world, $keys, $filter) {
    $this->travelTo(Carbon::parse('2026-10-28 10:00', 'Europe/Berlin'));
    Organization::current()->update(['timezone' => 'Europe/Berlin']);
    [$web, , $mara] = $world();
    $app = Project::factory()->identifier('APP')->public()->create();
    WorkItem::factory()->for($web)->create(['created_at' => now(), 'title' => 'Formular']);
    WorkItem::factory()->for($app)->create(['created_at' => now(), 'title' => 'Formular']);
    WorkItem::factory()->for($app)->archived()->create(['created_at' => now(), 'title' => 'Formular']);
    WorkItem::factory()->for($web)->create(['created_at' => now()->subDays(3), 'title' => 'Formular']);
    WorkItem::factory()->for($web)->create(['created_at' => now(), 'title' => 'Login']);
    $today = $filter(['field' => 'created_at', 'op' => 'is', 'value' => 'today']);

    foreach (['key', 'state_category'] as $field) {
        // K3: both joins meet the qualified columns of the archive rules and of the condition
        expect($keys(QueryWorkItems::run(actor($mara), ['filter' => $today, 'sort' => ['field' => $field, 'direction' => 'asc'], 'q' => 'formular'])))
            ->toEqualCanonicalizing(['APP-1', 'WEB-1'], $field)
            ->and($keys(QueryWorkItems::run(actor($mara), ['filter' => $today, 'sort' => ['field' => $field, 'direction' => 'asc'], 'q' => 'web-3'])))
            ->toBe(['WEB-3'], $field);
    }
});

it('never moves items of a project being deleted into a page', function () use ($world, $keys, $filter) {
    [$web, , $mara] = $world();
    $admin = User::factory()->admin()->create();
    $gone = Project::factory()->identifier('GONE')->public()->create();
    WorkItem::factory()->for($web)->create();
    WorkItem::factory()->for($gone)->count(2)->create();
    $gone->update(['deleting_at' => now()]);

    foreach ([$mara, $admin] as $reader) {
        $named = QueryWorkItems::run(actor($reader), ['filter' => $filter(['field' => 'project', 'op' => 'in', 'value' => [$gone->id, $web->id]]), 'include_archived' => true]);
        expect($keys($named))->toBe(['WEB-1'])->and($named->total)->toBe(1)
            ->and($keys(QueryWorkItems::run(actor($reader), ['include_archived' => true])))->toBe(['WEB-1']);
    }
    expect(fn () => QueryWorkItems::run(actor($admin), ['shorthand' => ['project' => 'GONE']]))
        ->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404));
});

it('reads the query string with its own rules', function () use ($world, $errors) {
    [$web, , $mara] = $world();
    WorkItem::factory()->for($web)->create();

    expect($errors(fn () => ListWorkItems::run(actor($mara), [
        'include' => 'children', 'include_archived' => 'yes', 'lean' => 'x', 'sort' => ['due_date'], 'filter' => 'WEB', 'per_page' => 500,
    ])))->toBe([
        'include' => __('field.include.list'),
        'include_archived' => __('field.include_archived.invalid'),
        'lean' => __('field.boolean'),
        'sort' => __('field.sort.invalid'),
        'filter' => __('field.filter.invalid', ['keys' => implode(', ', Shorthand::KEYS)]),
        'per_page' => __('validation.between.numeric', ['attribute' => 'per page', 'min' => 1, 'max' => 100]),
    ])
        ->and($errors(fn () => ListWorkItems::run(actor($mara), ['sort' => 'title', 'filter' => ['type' => 'x']])))
        ->toBe(['sort' => __('field.sort.invalid'), 'filter.type' => __('field.filter.value')])
        // other keys of a query string are passed over
        ->and(ListWorkItems::run(actor($mara), ['_' => '123', 'lean' => '1'])->page->items()[0]->lean)->toBeTrue();
});
