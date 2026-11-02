<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\GroupWorkItems;
use App\Domain\Views\GroupBy;
use App\Domain\WorkItems\Priority;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Views\GroupCount;
use App\Views\ItemGroups;
use Illuminate\Validation\ValidationException;

/*
 * `GroupWorkItems`: the grouping that holds, the number of all matches and the groups in display order; the body is
 * that of a query without the short form, the group, the page and `lean` (K8); `group_by` is required.
 */

/** WEB (public) with Mara as member, APP (public) on a workflow of its own. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Member)->create(['name' => 'Website']);
    $app = Project::factory()->identifier('APP')->public()->create(['name' => 'App', 'workflow_id' => Workflow::factory()->create()->id]);

    return [$mara, $web, $app];
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

/** [key, count] of each group. */
$shape = fn (ItemGroups $groups): array => array_map(fn (GroupCount $group) => [$group->key, $group->count], $groups->groups);

it('answers the effective grouping, the total and the groups in display order', function () use ($world, $shape) {
    [$mara, $web, $app] = $world();
    WorkItem::factory()->for($web)->inState('Todo')->create(['priority' => Priority::High]);
    WorkItem::factory()->for($web)->create(['priority' => Priority::High]);
    WorkItem::factory()->for($app)->create(['priority' => Priority::Low]);
    WorkItem::factory()->for($app)->archived()->create();
    $view = View::factory()->create(['filter' => ['version' => 1, 'conditions' => [['field' => 'priority', 'op' => 'in', 'value' => ['high', 'low']]]]]);

    $all = GroupWorkItems::run(actor($mara), ['group_by' => 'state']);
    $web = GroupWorkItems::run(actor($mara), ['group_by' => 'priority', 'view_id' => $view->id, 'q' => '', 'sort' => ['field' => 'due_date', 'direction' => 'asc']]);

    // two workflows: by category; the archived item stays out
    expect($all->groupBy)->toBe(GroupBy::Category)
        ->and($all->total)->toBe(3)
        ->and($shape($all))->toBe([['backlog', 2], ['unstarted', 1], ['started', 0], ['completed', 0], ['canceled', 0]])
        ->and($web->groupBy)->toBe(GroupBy::Priority)
        ->and($shape($web))->toBe([['urgent', 0], ['high', 2], ['medium', 0], ['low', 1], ['none', 0]])
        ->and(GroupWorkItems::run(actor($mara), ['group_by' => 'state', 'include_archived' => true])->total)->toBe(4);
});

it('answers one group all for group_by none', function () use ($world, $shape) {
    [$mara, $web] = $world();
    WorkItem::factory()->for($web)->count(2)->create();

    $groups = GroupWorkItems::run(actor($mara), ['group_by' => 'none']);

    expect($groups->groupBy)->toBe(GroupBy::None)->and($groups->total)->toBe(2)->and($shape($groups))->toBe([['all', 2]]);
});

it('requires group_by', function () use ($world, $errors) {
    [$mara] = $world();
    $unknown = __('field.query.unknown', ['keys' => implode(', ', GroupWorkItems::KEYS)]);

    expect($errors(fn () => GroupWorkItems::run(actor($mara), [])))->toBe(['group_by' => __('field.group_by.required')])
        ->and($errors(fn () => GroupWorkItems::run(actor($mara), ['group_by' => 'status'])))->toBe(['group_by' => __('field.group_by.invalid')])
        // no short form (K8), no group, no page: a short-form project is never read, so it is no 404
        ->and($errors(fn () => GroupWorkItems::run(actor($mara), ['group_by' => 'state', 'shorthand' => ['project' => 'NOPE'], 'group' => 'all', 'cursor' => 'x', 'lean' => true])))
        ->toBe(['shorthand' => $unknown, 'group' => $unknown, 'cursor' => $unknown, 'lean' => $unknown]);
});

it('answers 404 for an unknown view', function () use ($world) {
    [$mara] = $world();

    expect(fn () => GroupWorkItems::run(actor($mara), ['group_by' => 'state', 'view_id' => 'nope']))->toThrow(Problem::class);
});
