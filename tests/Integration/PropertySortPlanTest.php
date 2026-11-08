<?php

use App\Actions\WorkItems\QueryWorkItems;
use App\Domain\Ranking\Rank;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use App\Views\CatalogProperties;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
 * The plan of the sort by a property (Phase 15, Task 10a): under 50 000 items its first value cost two reads per item,
 * one for the mark of an empty value and one for the value, each from the row of `work_item_values` (CI 1.8 s). The
 * first value is joined once (`sort_values`) and read from the index `work_item_values_sort_index` alone. The plan is
 * read with EXPLAIN on the real query of a page, after ANALYZE TABLE, on a few hundred items.
 */

/**
 * The query of the first page sorted by effort (with its bindings) and the tables of its plan named `sort_values`.
 *
 * @return list<array<string, mixed>>
 */
$sortValuesInPlan = function (string $direction): array {
    $reader = User::factory()->admin()->create();
    $project = Project::factory()->public()->create(['lead_id' => $reader->id]);
    $task = WorkItemType::query()->where('name', 'Task')->sole();
    $effort = Property::query()->where('key', 'effort')->sole();
    $task->typeProperties()->create(['property_id' => $effort->id, 'required' => false, 'position' => 0]);
    app()->instance(CatalogProperties::class, CatalogProperties::load());

    $state = Workflow::default()->initial_state_id;
    $now = now()->utc();
    $items = $values = [];
    foreach (Rank::nBetween(null, null, 400) as $index => $rank) {
        $id = strtolower((string) Str::ulid());
        $items[] = ['id' => $id, 'project_id' => $project->id, 'number' => $index + 1, 'type_id' => $task->id, 'title' => "Item {$index}",
            'state_id' => $state, 'priority' => 'none', 'rank' => $rank, 'created_by' => $reader->id, 'description_version' => 1,
            'created_at' => $now, 'updated_at' => $now];
        if ($index % 5 !== 0) {
            $values[] = ['id' => strtolower((string) Str::ulid()), 'work_item_id' => $id, 'property_id' => $effort->id, 'position' => 0,
                'value_number' => sprintf('%.4F', $index % 13), 'created_at' => $now, 'updated_at' => $now];
        }
    }
    foreach (['work_items' => $items, 'work_item_values' => $values] as $table => $rows) {
        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table($table)->insert($chunk);
        }
    }
    DB::statement('analyze table `work_items`, `work_item_values`, `type_properties`');

    $page = null;
    DB::listen(function (QueryExecuted $query) use (&$page) {
        if (str_contains($query->sql, 'as sort_0')) {
            $page = $query;
        }
    });
    $answer = QueryWorkItems::run(actor($reader), ['sort' => ['field' => 'property:effort', 'direction' => $direction], 'per_page' => 100]);
    expect($answer->page->items())->toHaveCount(100)
        ->and($page)->toBeInstanceOf(QueryExecuted::class);

    $plan = json_decode((string) DB::selectOne('explain format=json '.$page->sql, $page->bindings)->EXPLAIN, true);
    $found = [];
    $walk = function (mixed $node) use (&$walk, &$found): void {
        if (! is_array($node)) {
            return;
        }
        if (($node['table_name'] ?? null) === 'sort_values') {
            $found[] = $node;
        }
        foreach ($node as $child) {
            $walk($child);
        }
    };
    $walk($plan);

    return $found;
};

it('reads the first value of a property once per item', function (string $direction) use ($sortValuesInPlan) {
    expect($sortValuesInPlan($direction))->toHaveCount(1);
})->with(['asc', 'desc']);

it('reads the first value of a property from an index alone', function (string $direction) use ($sortValuesInPlan) {
    $tables = $sortValuesInPlan($direction);

    expect(count($tables))->toBeGreaterThanOrEqual(1);
    foreach ($tables as $table) {
        expect($table['key'] ?? null)->toBe('work_item_values_sort_index')
            ->and($table['using_index'] ?? false)->toBeTrue();
    }
})->with(['asc', 'desc']);
