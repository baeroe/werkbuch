<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\QueryWorkItems;
use App\Domain\WorkItems\Priority;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItem;
use App\Support\ListResult;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/*
 * Mutation table: what would turn a case red.
 * - sees: dropping `visibleTo` / the archive condition from `ItemQuery::for`, or `include_archived` read as `true`.
 * - views: reading the sort or sub-items of the view before those of the request (the request replaces them).
 * - search: `findByReference` without the visibility check, or the key matched as a title.
 * The items these tests read come from `ItemQuery` and `ItemOrder::page`: their rows carry `sort_*` and `_sig` as
 * original attributes for the cursor, so a `save()` writes only what changed and never those columns.
 */

/*
 * The one query over items (ItemQuery): only what the reader sees, the archive rules (P5), sub-items, a view narrowed
 * by the request, and the search of Phase 4.
 */

/**
 * WEB (public) with Mara as member, the private OPS with Jonas, and Ida, who is in neither (an outsider of OPS).
 *
 * @return array{web: Project, ops: Project, mara: User, jonas: User, ida: User}
 */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $jonas = User::factory()->create(['name' => 'Jonas']);
    $ida = User::factory()->create(['name' => 'Ida']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Member)->create();
    $ops = Project::factory()->identifier('OPS')->private()->member($jonas, ProjectRole::Member)->create();

    return compact('web', 'ops', 'mara', 'jonas', 'ida');
};

/**
 * The keys of a page, in its order.
 *
 * @param  ListResult<WorkItem>  $result
 * @return list<string>
 */
$keys = fn (ListResult $result): array => array_values(array_map(fn (WorkItem $item) => $item->key, $result->page->items()));

/** A filter of these conditions. */
$filter = fn (array ...$conditions): array => ['version' => 1, 'conditions' => array_values($conditions)];

it('never lists, counts or names items of a project the reader may not see', function () use ($world, $keys, $filter) {
    ['web' => $web, 'ops' => $ops, 'jonas' => $jonas, 'ida' => $ida] = $world();
    WorkItem::factory()->for($web)->create(['assignee_id' => null]);
    $epic = WorkItem::factory()->for($ops)->epic()->create(['assignee_id' => $jonas->id]);
    WorkItem::factory()->for($ops)->childOf($epic)->create(['assignee_id' => $jonas->id]);

    $cases = [
        'no condition' => $filter(),
        'the project' => $filter(['field' => 'project', 'op' => 'in', 'value' => [$ops->id]]),
        'the parent' => $filter(['field' => 'parent', 'op' => 'is', 'value' => $epic->id]),
        'a member of the project' => $filter(['field' => 'assignee', 'op' => 'is', 'value' => $jonas->id]),
    ];
    foreach ($cases as $case => $body) {
        $result = QueryWorkItems::run(actor($ida), ['filter' => $body, 'include_archived' => true]);
        $listed = $keys($result);

        expect(array_filter($listed, fn (string $key) => str_starts_with($key, 'OPS')))->toBe([], $case)
            ->and($result->total)->toBe(count($listed), $case);
    }
    // Jonas sees them
    expect($keys(QueryWorkItems::run(actor($jonas), ['filter' => $cases['the parent']])))->toBe(['OPS-2']);

    // nor through REST, on both ways of asking
    $this->actingAs($ida)->getJson("/api/v1/work-items?filter[assignee]={$jonas->id}")->assertOk()
        ->assertJsonPath('meta.total', 0)->assertJsonPath('data', []);
    $this->actingAs($ida)->postJson('/api/v1/work-items/query', ['filter' => $cases['the parent']])->assertOk()
        ->assertJsonPath('meta.total', 0)->assertJsonPath('data', []);
});

it('answers a ULID of a hidden project like an unknown one', function () use ($world, $filter) {
    ['web' => $web, 'ops' => $ops, 'ida' => $ida] = $world();
    WorkItem::factory()->for($web)->create();
    WorkItem::factory()->for($ops)->create();
    $ask = fn (string $id) => $this->actingAs($ida)->postJson('/api/v1/work-items/query', [
        'filter' => $filter(['field' => 'project', 'op' => 'in', 'value' => [$id]]),
    ])->assertOk()->json();

    $hidden = $ask($ops->id);
    $unknown = $ask(strtolower((string) Str::ulid()));

    expect($hidden['meta']['total'])->toBe(0)
        ->and($hidden['data'])->toBe([])
        ->and($hidden)->toBe($unknown);
});

it('hides archived items unless the filter asks for archived or include_archived is set', function () use ($world, $keys, $filter) {
    ['web' => $web, 'mara' => $mara] = $world();
    WorkItem::factory()->for($web)->create();
    WorkItem::factory()->for($web)->archived()->create();
    $ask = fn (array $input) => $keys(QueryWorkItems::run(actor($mara), $input));

    expect($ask([]))->toBe(['WEB-1'])
        ->and($ask(['filter' => $filter(['field' => 'archived', 'op' => 'is', 'value' => true])]))->toBe(['WEB-2'])
        ->and($ask(['filter' => $filter(['field' => 'archived', 'op' => 'is', 'value' => false])]))->toBe(['WEB-1'])
        ->and($ask(['shorthand' => ['archived' => 'true']]))->toBe(['WEB-2'])
        ->and($ask(['include_archived' => true]))->toBe(['WEB-1', 'WEB-2']);
});

it('shows the items of an archived project the filter names, without its archived items', function () use ($world, $keys, $filter) {
    ['web' => $web, 'mara' => $mara] = $world();
    $old = Project::factory()->identifier('OLD')->public()->archived()->create();
    WorkItem::factory()->for($web)->create();
    WorkItem::factory()->for($old)->create();
    WorkItem::factory()->for($old)->archived()->create();
    $ask = fn (array $input) => $keys(QueryWorkItems::run(actor($mara), $input));

    expect($ask(['filter' => $filter(['field' => 'project', 'op' => 'is', 'value' => $old->id])]))->toBe(['OLD-1'])
        ->and($ask(['filter' => $filter(['field' => 'project', 'op' => 'in', 'value' => [$web->id, $old->id]])]))->toEqualCanonicalizing(['WEB-1', 'OLD-1'])
        ->and($ask(['shorthand' => ['project' => 'OLD']]))->toBe(['OLD-1'])
        ->and($ask(['filter' => $filter(['field' => 'project', 'op' => 'is', 'value' => $old->id]), 'include_archived' => true]))->toBe(['OLD-1', 'OLD-2']);
});

it('leaves out the items of archived projects otherwise', function () use ($world, $keys, $filter) {
    ['web' => $web, 'mara' => $mara] = $world();
    $old = Project::factory()->identifier('OLD')->public()->archived()->create();
    $app = Project::factory()->identifier('APP')->public()->create();
    WorkItem::factory()->for($web)->create();
    WorkItem::factory()->for($old)->create();
    WorkItem::factory()->for($app)->create();
    $ask = fn (array $input) => $keys(QueryWorkItems::run(actor($mara), $input));

    // only `is` and `in` name a project; naming another one or leaving one out names none
    expect($ask([]))->toEqualCanonicalizing(['WEB-1', 'APP-1'])
        ->and($ask(['filter' => $filter(['field' => 'project', 'op' => 'is_not', 'value' => $web->id])]))->toBe(['APP-1'])
        ->and($ask(['filter' => $filter(['field' => 'project', 'op' => 'not_in', 'value' => [$app->id]])]))->toBe(['WEB-1'])
        ->and($ask(['filter' => $filter(['field' => 'project', 'op' => 'is', 'value' => $app->id])]))->toBe(['APP-1'])
        ->and($ask(['include_archived' => true]))->toEqualCanonicalizing(['WEB-1', 'OLD-1', 'APP-1']);
});

it('leaves sub-items out when show_sub_items is false', function () use ($world, $keys) {
    ['web' => $web, 'mara' => $mara] = $world();
    $epic = WorkItem::factory()->for($web)->epic()->create();
    WorkItem::factory()->for($web)->childOf($epic)->create();
    WorkItem::factory()->for($web)->create();
    $ask = fn (array $input) => $keys(QueryWorkItems::run(actor($mara), $input));

    expect($ask(['show_sub_items' => false]))->toBe(['WEB-1', 'WEB-3'])
        ->and($ask(['show_sub_items' => true]))->toBe(['WEB-1', 'WEB-2', 'WEB-3'])
        ->and($ask([]))->toBe(['WEB-1', 'WEB-2', 'WEB-3']);
});

it('takes the filter, the sort and the sub-items of a view, the request narrows and replaces', function () use ($world, $keys, $filter) {
    $this->travelTo(Carbon::parse('2026-10-28 10:00', 'Europe/Berlin'));
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'week_start' => 1]);
    ['web' => $web, 'mara' => $mara] = $world();
    $epic = WorkItem::factory()->for($web)->epic()->create(['due_date' => '2026-10-30', 'created_at' => '2026-10-02 08:00:00']);
    WorkItem::factory()->for($web)->childOf($epic)->create(['due_date' => '2026-10-27']);
    WorkItem::factory()->for($web)->create(['due_date' => '2026-10-29', 'priority' => Priority::Urgent, 'created_at' => '2026-10-01 08:00:00']);
    WorkItem::factory()->for($web)->create(['due_date' => '2026-11-20']);
    WorkItem::factory()->for($web)->create(['due_date' => '2026-10-26', 'priority' => Priority::Urgent, 'created_at' => '2026-10-03 08:00:00']);
    // like `v_due_week` of the clickdummy: due this week, by due date, without sub-items
    $view = View::factory()->create([
        'filter' => $filter(['field' => 'due_date', 'op' => 'is', 'value' => 'this_week']),
        'display' => ['layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'due_date', 'direction' => 'asc'], 'fields' => [], 'show_sub_items' => false],
    ]);
    $ask = fn (array $input) => $keys(QueryWorkItems::run(actor($mara), ['view_id' => strtoupper($view->id), ...$input]));

    expect($ask([]))->toBe(['WEB-5', 'WEB-3', 'WEB-1'])
        ->and($ask(['show_sub_items' => true]))->toBe(['WEB-5', 'WEB-2', 'WEB-3', 'WEB-1'])
        ->and($ask(['filter' => $filter(['field' => 'priority', 'op' => 'is', 'value' => 'urgent'])]))->toBe(['WEB-5', 'WEB-3'])
        ->and($ask(['sort' => ['field' => 'created_at', 'direction' => 'desc']]))->toBe(['WEB-5', 'WEB-1', 'WEB-3']);
});

it('finds by key or by part of the title', function () use ($world, $keys) {
    ['web' => $web, 'ops' => $ops, 'mara' => $mara] = $world();
    $web->identifiers()->create(['identifier' => 'OLD']);
    WorkItem::factory()->for($web)->create(['title' => '100% Abdeckung']);
    WorkItem::factory()->for($web)->create(['title' => 'snake_case umbenennen']);
    WorkItem::factory()->for($web)->create(['title' => 'Wartet auf OPS-1 und WEB-99']);
    WorkItem::factory()->for($ops)->create(['title' => 'Geheim']);
    $body = fn (string $q) => $keys(QueryWorkItems::run(actor($mara), ['q' => $q]));
    $short = fn (string $q) => $keys(QueryWorkItems::run(actor($mara), ['shorthand' => ['q' => $q]]));

    foreach ([$body, $short] as $search) {
        expect($search('100%'))->toBe(['WEB-1'])
            ->and($search('e_c'))->toBe(['WEB-2'])
            ->and($search(' web-2 '))->toBe(['WEB-2'])
            ->and($search('OLD-3'))->toBe(['WEB-3'])
            // a hidden key reads like an unknown one: a part of the title
            ->and($search('OPS-1'))->toBe(['WEB-3'])
            ->and($search('WEB-99'))->toBe(['WEB-3'])
            ->and($search('   '))->toHaveCount(3);
    }
});
