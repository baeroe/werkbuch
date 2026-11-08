<?php

use App\Actions\WorkItems\CountWorkItems;
use App\Actions\WorkItems\GroupWorkItems;
use App\Actions\WorkItems\QueryWorkItems;
use App\Domain\Ranking\Rank;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
 * The join order of the item queries (Phase 15, Task 10c): under 50 000 items every count and group over all projects
 * got about 370 ms slower in CI from one run to the next (PR #32, runs 42439150185 and 42445465516), with no change to
 * the code that builds them. ItemQuery left the items of archived projects out with `project_id in (select id from
 * projects …)`, a semi-join MariaDB flattens into the join: it could scan the items and look up their project (cost
 * 53.74 in DDEV), or begin with the 20 projects and read the items of each through an index of `project_id` and then
 * their rows for `archived_at` (cost 53.77, 105 ms against 12 ms in DDEV). The tie fell either way with the sampled
 * statistics. `project_id not in (select id from archived projects)` is a subquery MariaDB materializes once: the
 * projects never join the items, and no join order hangs on the statistics. The plan is read with EXPLAIN on the real
 * queries, after ANALYZE TABLE, on a few hundred items, also for a list that names an archived project (P5: its open
 * items, the subquery then leaves the named project out).
 */

it('never joins the projects into the items it counts, groups or lists', function () {
    $reader = User::factory()->admin()->create();
    $projects = Project::factory()->public()->count(4)->create(['lead_id' => $reader->id]);
    $archived = Project::factory()->public()->archived()->create(['lead_id' => $reader->id]);
    $task = WorkItemType::query()->where('name', 'Task')->sole();
    $states = Workflow::default()->states()->pluck('id')->all();
    $now = now()->utc();

    $items = [];
    foreach ([...$projects, $archived] as $p => $project) {
        foreach (Rank::nBetween(null, null, 80) as $index => $rank) {
            $items[] = ['id' => strtolower((string) Str::ulid()), 'project_id' => $project->id, 'number' => $index + 1,
                'type_id' => $task->id, 'title' => "Item {$p}-{$index}", 'state_id' => $states[$index % count($states)],
                'priority' => 'none', 'rank' => $rank, 'created_by' => $reader->id, 'description_version' => 1,
                'archived_at' => $index % 10 === 0 ? $now : null, 'created_at' => $now, 'updated_at' => $now];
        }
    }
    foreach (array_chunk($items, 200) as $chunk) {
        DB::table('work_items')->insert($chunk);
    }
    DB::statement('analyze table `work_items`, `projects`, `workflow_states`');

    $backlog = DB::table('work_items')->join('workflow_states', 'workflow_states.id', '=', 'work_items.state_id')
        ->whereIn('work_items.project_id', $projects->modelKeys())->whereNull('work_items.archived_at')
        ->where('workflow_states.category', 'backlog')->count();

    $read = [];
    DB::listen(function (QueryExecuted $query) use (&$read) {
        // the queries whose first table is the items (not the catalog of the workflows, which reads the projects); the
        // first `from` of the computed columns of a page is that of their first subselect (`work_items as children`),
        // so that statement counts as well
        if (preg_match('/^select .*? from `(\w+)`/', $query->sql, $from) === 1 && $from[1] === 'work_items') {
            $read[] = $query;
        }
    });
    $actor = actor($reader);
    $none = GroupWorkItems::run($actor, ['group_by' => 'none']);
    $state = GroupWorkItems::run($actor, ['group_by' => 'state']);
    $counts = CountWorkItems::run($actor, ['filters' => (object) [
        'backlog' => ['version' => 1, 'conditions' => [['field' => 'state_category', 'op' => 'is', 'value' => 'backlog']]],
    ]]);
    $page = QueryWorkItems::run($actor, ['lean' => true, 'per_page' => 100]);
    // the list and the board of an archived project next to an open one (P5)
    $named = ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'in', 'value' => [$archived->id, $projects[0]->id]]]];
    $namedGroups = GroupWorkItems::run($actor, ['group_by' => 'none', 'filter' => $named]);
    $namedPage = QueryWorkItems::run($actor, ['lean' => true, 'per_page' => 100, 'filter' => $named]);

    // the answer: the open items of the four open projects, never those of the archived one, unless the list names it
    $open = 4 * 72;
    expect($none->total)->toBe($open)
        ->and($state->total)->toBe($open)
        ->and($page->total)->toBe($open)
        ->and($counts['backlog'])->toBe($backlog)->toBeGreaterThan(0)
        ->and($namedGroups->total)->toBe(2 * 72)
        ->and($namedPage->total)->toBe(2 * 72)
        ->and(collect($namedPage->page->items())->pluck('project_id')->unique()->sort()->values()->all())
        ->toBe(collect([$archived->id, $projects[0]->id])->sort()->values()->all())
        // the total and the tally of each grouping, the count, the page and its count, the computed columns of a page;
        // for the archived project named the total and tally, the page, its count and its computed columns
        ->and($read)->toHaveCount(13)
        // there the subquery leaves the named projects out of the archived ones
        ->and(count(array_filter($read, fn (QueryExecuted $query) => str_contains($query->sql, '`projects`.`id` not in (?, ?)'))))->toBe(4);

    $materialized = 0;
    foreach ($read as $query) {
        $plan = json_decode((string) DB::selectOne('explain format=json '.$query->sql, $query->bindings)->EXPLAIN, true);
        // the tables the query joins (also under a sort or a temporary table), without the subqueries run apart
        $joined = [];
        $walk = function (mixed $node) use (&$walk, &$joined): void {
            if (! is_array($node)) {
                return;
            }
            if (array_key_exists('table_name', $node)) {
                $joined[] = $node['table_name'];
            }
            foreach ($node as $key => $child) {
                if ($key !== 'subqueries') {
                    $walk($child);
                }
            }
        };
        $walk($plan['query_block']);

        // every subquery that reads the projects runs once, materialized, never again per item (a dependent one would
        // also keep them out of the join)
        $subqueries = [];
        $collect = function (mixed $node) use (&$collect, &$subqueries): void {
            if (! is_array($node)) {
                return;
            }
            foreach ($node as $key => $child) {
                if ($key === 'subqueries' && is_array($child)) {
                    array_push($subqueries, ...$child);
                }
                $collect($child);
            }
        };
        $collect($plan);
        foreach ($subqueries as $subquery) {
            if (str_contains((string) json_encode($subquery), '"table_name":"projects"')) {
                expect(array_key_first($subquery))->toBe('materialization', "{$query->sql} reads the projects again per item");
                $materialized++;
            }
        }

        expect($joined)->toContain('work_items')
            ->and(in_array('projects', $joined, true))->toBeFalse("{$query->sql} joins the projects");
    }

    // the probe: every statement but the computed columns of the two pages leaves out the archived projects that way
    expect($materialized)->toBe(11);
});
