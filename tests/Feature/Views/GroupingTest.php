<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\GroupWorkItems;
use App\Domain\Views\GroupBy;
use App\Domain\WorkItems\Priority;
use App\Models\Label;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Views\GroupCount;
use App\Views\Grouping;
use App\Views\ItemQuery;
use App\Views\ItemQueryInput;
use Illuminate\Support\Str;

/*
 * The groups of an item list counted by the database (Grouping), ported from `src/domain/grouping.test.ts` and
 * `features/items/display/grouping.test.ts` of the clickdummy as far as they are about groups and their order, and
 * what the reader may not see (Review Focus 1).
 */

/**
 * Mara (the reader), Jonas and Ida, the bot Abby; WEB (public) and OPS (private, Jonas only) on the default workflow,
 * APP (public) on a workflow of its own.
 *
 * @return array{mara: User, jonas: User, ida: User, abby: User, web: Project, ops: Project, app: Project}
 */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara Lindqvist']);
    $jonas = User::factory()->create(['name' => 'Jonas Feld']);
    $ida = User::factory()->create(['name' => 'Ida Brenner']);
    $abby = User::factory()->bot()->create(['name' => 'Abby']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Member)->create(['name' => 'Website', 'lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($jonas, ProjectRole::Member)->create(['name' => 'Betrieb', 'lead_id' => $jonas->id]);
    $app = Project::factory()->identifier('APP')->public()->create(['name' => 'App', 'lead_id' => $mara->id, 'workflow_id' => Workflow::factory()->create()->id]);

    return compact('mara', 'jonas', 'ida', 'abby', 'web', 'ops', 'app');
};

/** A filter of these conditions. */
$filter = fn (array ...$conditions): array => ['version' => 1, 'conditions' => array_values($conditions)];

/**
 * The groups the reader gets for a body of `POST /query`, as [key, count] pairs.
 *
 * @return list<array{string, int}>
 */
$groups = function (User $reader, GroupBy $by, array $body = []): array {
    $input = ItemQueryInput::fromBody($body, actor($reader));

    return array_map(
        fn (GroupCount $group) => [$group->key, $group->count],
        Grouping::counts(ItemQuery::for(actor($reader), $input), $by, ItemQuery::filterOf($input), $reader),
    );
};

/** The grouping that holds for the reader and a body. */
$effective = fn (User $reader, GroupBy $by, array $body = []): GroupBy => Grouping::effective(ItemQuery::for(actor($reader), ItemQueryInput::fromBody($body, actor($reader))), $by);

/** The ULID of a state of a workflow by name. */
$state = fn (Workflow $workflow, string $name): string => WorkflowState::query()->where('workflow_id', $workflow->id)->where('name', $name)->sole()->id;

/** The ULIDs of the states of a workflow in their order. */
$states = fn (Workflow $workflow): array => $workflow->states()->pluck('id')->all();

it('falls back to category when the items span more than one workflow', function () use ($world, $effective, $groups) {
    ['mara' => $mara, 'web' => $web, 'app' => $app] = $world();
    WorkItem::factory()->for($web)->inState('Todo')->create();
    WorkItem::factory()->for($app)->create();

    expect($effective($mara, GroupBy::State))->toBe(GroupBy::Category)
        ->and($effective($mara, GroupBy::Assignee))->toBe(GroupBy::Assignee)
        ->and($groups($mara, GroupBy::Category))->toBe([['backlog', 1], ['unstarted', 1], ['started', 0], ['completed', 0], ['canceled', 0]]);
});

it('keeps state when all items share one workflow', function () use ($world, $effective) {
    ['mara' => $mara, 'jonas' => $jonas, 'web' => $web, 'ops' => $ops, 'app' => $app] = $world();
    WorkItem::factory()->for($web)->create();
    WorkItem::factory()->for($ops)->create();
    WorkItem::factory()->for($app)->create();
    $notApp = ['filter' => ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'is_not', 'value' => $app->id]]]];

    expect($effective($jonas, GroupBy::State, $notApp))->toBe(GroupBy::State)
        // only what the reader sees counts: Mara does not see the OPS item, so the workflows are WEB's and APP's
        ->and($effective($mara, GroupBy::State))->toBe(GroupBy::Category);
});

it('keeps state for no items at all', function () use ($world, $effective, $groups, $filter, $states) {
    ['mara' => $mara, 'ida' => $ida, 'ops' => $ops, 'app' => $app] = $world();
    WorkItem::factory()->for($ops)->create();
    $named = fn (string $id) => ['filter' => $filter(['field' => 'project', 'op' => 'is', 'value' => $id])];
    $appStates = array_map(fn (string $id) => [$id, 0], $states($app->workflow));

    expect($effective($mara, GroupBy::State, $named($app->id)))->toBe(GroupBy::State)
        // with the one named project: its states, empty
        ->and($groups($mara, GroupBy::State, $named($app->id)))->toBe($appStates)
        // without one: no column to show
        ->and($groups($mara, GroupBy::State, ['filter' => $filter(['field' => 'title', 'op' => 'contains', 'value' => 'nichts'])]))->toBe([])
        // a hidden project names nothing, like an unknown one (K7)
        ->and($groups($ida, GroupBy::State, $named($ops->id)))->toBe([])
        ->and($groups($ida, GroupBy::State, $named(strtolower((string) Str::ulid()))))->toBe([])
        ->and($groups($ida, GroupBy::Type, $named($ops->id)))->toBe($groups($ida, GroupBy::Type, $named(strtolower((string) Str::ulid()))))
        ->and($groups($ida, GroupBy::Project, $named($ops->id)))->toBe([]);
});

it('groups by state in the order the context gives, and keeps empty columns', function () use ($world, $groups, $state, $states) {
    ['mara' => $mara, 'web' => $web] = $world();
    $standard = Workflow::default();
    WorkItem::factory()->for($web)->inState('Done')->create();
    WorkItem::factory()->for($web)->inState('In Progress')->count(2)->create();
    WorkItem::factory()->for($web)->inState('Todo')->create();

    $expected = array_map(fn (string $id) => [$id, match ($id) {
        $state($standard, 'Todo') => 1,
        $state($standard, 'In Progress') => 2,
        $state($standard, 'Done') => 1,
        default => 0,
    }], $states($standard));

    expect($groups($mara, GroupBy::State))->toBe($expected)
        ->and(count($expected))->toBe(6)
        ->and($expected[0][0])->toBe($state($standard, 'Backlog'));
});

it('lists the states of several workflows by key when asked for state anyway', function () use ($world, $groups) {
    ['mara' => $mara, 'web' => $web, 'app' => $app] = $world();
    $items = [WorkItem::factory()->for($web)->create(), WorkItem::factory()->for($app)->create()];
    $keys = array_map(fn (WorkItem $item) => $item->state_id, $items);
    sort($keys);

    expect($groups($mara, GroupBy::State))->toBe(array_map(fn (string $key) => [$key, 1], $keys));
});

it('puts items without a value into the group "none"', function () use ($world, $groups) {
    ['mara' => $mara, 'jonas' => $jonas, 'web' => $web] = $world();
    WorkItem::factory()->for($web)->create(['assignee_id' => $jonas->id]);
    WorkItem::factory()->for($web)->create(['assignee_id' => null]);

    expect($groups($mara, GroupBy::Assignee))->toBe([[$jonas->id, 1], ['none', 1]])
        // the group stays when it is empty
        ->and($groups($mara, GroupBy::Assignee, ['filter' => ['version' => 1, 'conditions' => [['field' => 'assignee', 'op' => 'is_not_empty']]]]))
        ->toBe([[$jonas->id, 1], ['none', 0]]);
});

it('groups by priority', function () use ($world, $groups) {
    ['mara' => $mara, 'web' => $web] = $world();
    WorkItem::factory()->for($web)->create(['priority' => Priority::Urgent]);
    WorkItem::factory()->for($web)->create(['priority' => Priority::High]);
    WorkItem::factory()->for($web)->create(['priority' => Priority::Low]);
    WorkItem::factory()->for($web)->create(['priority' => Priority::None]);

    expect($groups($mara, GroupBy::Priority))->toBe([['urgent', 1], ['high', 1], ['medium', 0], ['low', 1], ['none', 1]]);
});

it('lists an item once per label and an item without labels under "none"', function () use ($world, $groups) {
    ['mara' => $mara, 'web' => $web] = $world();
    $ux = Label::factory()->create(['name' => 'UX']);
    $forms = Label::factory()->create(['name' => 'Formulare']);
    Label::factory()->create(['name' => 'Alt']);
    WorkItem::factory()->for($web)->create()->labels()->attach([$forms->id]);
    WorkItem::factory()->for($web)->create()->labels()->attach([$forms->id, $ux->id]);
    WorkItem::factory()->for($web)->create()->labels()->attach([$ux->id]);
    WorkItem::factory()->for($web)->create();

    $answer = GroupWorkItems::run(actor($mara), ['group_by' => 'label']);

    // by name; a label without items is no group
    expect($groups($mara, GroupBy::Label))->toBe([[$forms->id, 2], [$ux->id, 2], ['none', 1]])
        ->and($answer->total)->toBe(4)
        ->and(array_sum(array_map(fn (GroupCount $group) => $group->count, $answer->groups)))->toBe(5);
});

it('groups by project, type and parent', function () use ($world, $groups) {
    ['mara' => $mara, 'web' => $web, 'app' => $app] = $world();
    $bug = WorkItemType::query()->where('name', 'Bug')->sole();
    $task = WorkItemType::query()->where('name', 'Task')->sole();
    $late = Project::factory()->identifier('AAA')->public()->create(['name' => 'Zentrale', 'lead_id' => $mara->id]);
    $epic = WorkItem::factory()->for($web)->epic()->create();
    $second = WorkItem::factory()->for($late)->epic()->create();
    WorkItem::factory()->childOf($epic)->create(['type_id' => $bug->id]);
    WorkItem::factory()->childOf($second)->create(['type_id' => $task->id]);
    WorkItem::factory()->for($app)->create(['type_id' => $bug->id]);
    $web->types()->sync([$task->id, $bug->id, $epic->type_id]);

    $parents = GroupWorkItems::run(actor($mara), ['group_by' => 'parent'])->groups;
    $named = ['filter' => ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'is', 'value' => $web->id]]]];

    // projects by name (App, Website, Zentrale), the named one also without items
    expect($groups($mara, GroupBy::Project))->toBe([[$app->id, 1], [$web->id, 2], [$late->id, 2]])
        ->and($groups($mara, GroupBy::Project, ['filter' => ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'is', 'value' => $app->id], ['field' => 'type', 'op' => 'is', 'value' => $task->id]]]]))->toBe([[$app->id, 0]])
        // types in the order of the catalog: those that occur, with a named project also its enabled ones
        ->and($groups($mara, GroupBy::Type))->toBe([[$task->id, 1], [$bug->id, 2], [$epic->type_id, 2]])
        ->and($groups($mara, GroupBy::Type, ['filter' => ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'is', 'value' => $web->id], ['field' => 'epic', 'op' => 'is', 'value' => true]]]]))
        ->toBe([[$task->id, 0], [$bug->id, 0], [$epic->type_id, 1]])
        ->and($groups($mara, GroupBy::Type, $named))->toBe([[$task->id, 0], [$bug->id, 1], [$epic->type_id, 1]])
        // parents by key (AAA-1 before WEB-1), with their item, then none
        ->and(array_map(fn (GroupCount $group) => [$group->key, $group->count, $group->item?->key], $parents))
        ->toBe([[$second->id, 1, 'AAA-1'], [$epic->id, 1, 'WEB-1'], ['none', 3, null]]);
});

it('orders people first and by name, and names the group without an assignee', function () use ($world, $groups) {
    ['mara' => $mara, 'jonas' => $jonas, 'ida' => $ida, 'abby' => $abby, 'web' => $web] = $world();
    foreach ([$mara, $abby, $jonas, null] as $assignee) {
        WorkItem::factory()->for($web)->create(['assignee_id' => $assignee?->id]);
    }

    // the bot Abby after the people, though by name it would come first; Ida has no item
    expect($groups($mara, GroupBy::Assignee))->toBe([[$jonas->id, 1], [$mara->id, 1], [$abby->id, 1], ['none', 1]])
        ->and(collect($groups($mara, GroupBy::Assignee))->pluck(0))->not->toContain($ida->id);
});

it('puts everything into one group when there is no grouping', function () use ($world, $groups) {
    ['mara' => $mara, 'web' => $web] = $world();
    WorkItem::factory()->for($web)->count(3)->create();

    expect($groups($mara, GroupBy::None))->toBe([['all', 3]])
        ->and($groups($mara, GroupBy::None, ['q' => 'nichts davon']))->toBe([['all', 0]]);
});

it('counts no group of a project the reader may not see', function () use ($world, $groups) {
    ['jonas' => $jonas, 'ida' => $ida, 'web' => $web, 'ops' => $ops] = $world();
    $secret = Label::factory()->create(['name' => 'Geheim']);
    $shared = Label::factory()->create(['name' => 'Gemeinsam']);
    WorkItem::factory()->for($web)->create(['assignee_id' => null])->labels()->attach([$shared->id]);
    foreach (range(1, 2) as $n) {
        WorkItem::factory()->for($ops)->create(['assignee_id' => $jonas->id])->labels()->attach([$secret->id, $shared->id]);
    }
    $all = ['include_archived' => true];

    expect($groups($ida, GroupBy::Project, $all))->toBe([[$web->id, 1]])
        ->and($groups($ida, GroupBy::Label, $all))->toBe([[$shared->id, 1], ['none', 0]])
        ->and($groups($ida, GroupBy::Assignee, $all))->toBe([['none', 1]])
        ->and(GroupWorkItems::run(actor($ida), ['group_by' => 'label'])->total)->toBe(1)
        // Jonas sees all of it
        ->and($groups($jonas, GroupBy::Label, $all))->toBe([[$secret->id, 2], [$shared->id, 3], ['none', 0]]);
});

it('names a parent group only through a visible parent', function () use ($world) {
    ['jonas' => $jonas, 'ida' => $ida, 'web' => $web, 'ops' => $ops] = $world();
    $public = WorkItem::factory()->for($web)->epic()->create();
    $private = WorkItem::factory()->for($ops)->epic()->create();
    WorkItem::factory()->childOf($public)->create();
    WorkItem::factory()->childOf($private)->create();
    $shape = fn (User $reader) => array_map(
        fn (GroupCount $group) => [$group->key, $group->count, $group->item?->title],
        GroupWorkItems::run(actor($reader), ['group_by' => 'parent'])->groups,
    );

    expect($shape($ida))->toBe([[$public->id, 1, $public->title], ['none', 1, null]])
        ->and($shape($jonas))->toBe([[$private->id, 1, $private->title], [$public->id, 1, $public->title], ['none', 2, null]]);
});

it('never names a parent the reader may not see, not even from a row built by hand', function () use ($world) {
    ['ida' => $ida, 'web' => $web, 'ops' => $ops] = $world();
    $private = WorkItem::factory()->for($ops)->epic()->create();
    // a parent lives in the project of its child: only a row written by hand points elsewhere
    $child = WorkItem::factory()->for($web)->create();
    $child->forceFill(['parent_id' => $private->id])->saveQuietly();
    WorkItem::factory()->for($web)->create();

    $groups = GroupWorkItems::run(actor($ida), ['group_by' => 'parent'])->groups;

    expect(array_map(fn (GroupCount $group) => [$group->key, $group->count, $group->item], $groups))->toBe([['none', 2, null]]);
});

it('reads the key of a group in its stored form, and nothing else', function () {
    $ulid = (string) Str::ulid();

    expect(Grouping::key(GroupBy::State, $ulid))->toBe(strtolower($ulid))
        ->and(Grouping::key(GroupBy::State, 'backlog'))->toBeNull()
        ->and(Grouping::key(GroupBy::Type, 'none'))->toBeNull()
        ->and(Grouping::key(GroupBy::Project, '8ZZZZZZZZZZZZZZZZZZZZZZZZZ'))->toBeNull()
        ->and(Grouping::key(GroupBy::Assignee, 'none'))->toBe('none')
        ->and(Grouping::key(GroupBy::Label, $ulid))->toBe(strtolower($ulid))
        ->and(Grouping::key(GroupBy::Parent, 'NONE'))->toBeNull()
        ->and(Grouping::key(GroupBy::Category, 'started'))->toBe('started')
        ->and(Grouping::key(GroupBy::Category, 'Started'))->toBeNull()
        ->and(Grouping::key(GroupBy::Priority, 'urgent'))->toBe('urgent')
        ->and(Grouping::key(GroupBy::Priority, 'asap'))->toBeNull()
        ->and(Grouping::key(GroupBy::None, 'all'))->toBe('all')
        ->and(Grouping::key(GroupBy::None, 'none'))->toBeNull();
});

it('takes only the items of one group, for every grouping', function () use ($world, $state) {
    ['mara' => $mara, 'web' => $web, 'app' => $app] = $world();
    $ux = Label::factory()->create(['name' => 'UX']);
    $epic = WorkItem::factory()->for($web)->epic()->create(['priority' => Priority::High]);
    $child = WorkItem::factory()->childOf($epic)->inState('Todo')->create(['assignee_id' => $mara->id]);
    $child->labels()->attach([$ux->id]);
    $other = WorkItem::factory()->for($app)->create();
    $ids = function (GroupBy $by, string $key) use ($mara): array {
        $query = ItemQuery::for(actor($mara), ItemQueryInput::fromBody([], actor($mara)));
        Grouping::restrict($query, $by, $key);

        return $query->orderBy('work_items.id')->pluck('work_items.id')->all();
    };
    $sorted = function (WorkItem ...$items): array {
        $ids = array_map(fn (WorkItem $item) => $item->id, $items);
        sort($ids);

        return $ids;
    };

    expect($ids(GroupBy::State, strtoupper($state(Workflow::default(), 'Todo'))))->toBe([$child->id])
        ->and($ids(GroupBy::Category, 'backlog'))->toBe($sorted($epic, $other))
        ->and($ids(GroupBy::Assignee, $mara->id))->toBe([$child->id])
        ->and($ids(GroupBy::Assignee, 'none'))->toBe($sorted($epic, $other))
        ->and($ids(GroupBy::Priority, 'high'))->toBe([$epic->id])
        ->and($ids(GroupBy::Type, $epic->type_id))->toBe([$epic->id])
        ->and($ids(GroupBy::Label, $ux->id))->toBe([$child->id])
        ->and($ids(GroupBy::Label, 'none'))->toBe($sorted($epic, $other))
        ->and($ids(GroupBy::Project, $app->id))->toBe([$other->id])
        ->and($ids(GroupBy::Parent, $epic->id))->toBe([$child->id])
        ->and($ids(GroupBy::Parent, 'none'))->toBe($sorted($epic, $other))
        ->and($ids(GroupBy::None, 'all'))->toBe($sorted($epic, $child, $other))
        // a key no group can have matches nothing
        ->and($ids(GroupBy::Priority, 'asap'))->toBe([]);
});
