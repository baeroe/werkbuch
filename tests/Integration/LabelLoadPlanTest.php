<?php

use App\Actions\WorkItems\QueryWorkItems;
use App\Domain\Ranking\Rank;
use App\Models\Label;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
 * The plan of the labels of a page (Phase 15, Task 10b): under 50 000 items the board of a project took 2.2 s in CI.
 * Each of its pages read the labels of its items with a join of `labels` and `work_item_labels`, and depending on the
 * statistics MariaDB began with the eight labels and walked the index of `label_id` through every link of the
 * organisation (75 000 index entries and their rows, 126 ms per page in DDEV, against 0.5 ms the other way round). The
 * labels of a page come from `work_item_labels` alone, through its index (work_item_id, label_id): no join order to
 * choose. The plan is read with EXPLAIN on the real query of a page, after ANALYZE TABLE, on a few hundred items.
 */

it('reads the labels of a page from work_item_labels alone, through its index', function () {
    $reader = User::factory()->admin()->create();
    $project = Project::factory()->public()->create(['lead_id' => $reader->id]);
    $labels = Label::factory()->count(8)->create()->modelKeys();
    $task = WorkItemType::query()->where('name', 'Task')->sole();
    $state = Workflow::default()->initial_state_id;
    $now = now()->utc();

    $items = $links = [];
    foreach (Rank::nBetween(null, null, 400) as $index => $rank) {
        $id = strtolower((string) Str::ulid());
        $items[] = ['id' => $id, 'project_id' => $project->id, 'number' => $index + 1, 'type_id' => $task->id, 'title' => "Item {$index}",
            'state_id' => $state, 'priority' => 'none', 'rank' => $rank, 'created_by' => $reader->id, 'description_version' => 1,
            'created_at' => $now, 'updated_at' => $now];
        // none, one or two labels, the second one created before the first: the order of the links is not that of the labels
        foreach (array_slice([$labels[($index + 3) % 8], $labels[$index % 8]], 0, $index % 3) as $label) {
            $links[] = ['id' => strtolower((string) Str::ulid()), 'work_item_id' => $id, 'label_id' => $label, 'created_at' => $now, 'updated_at' => $now];
        }
    }
    foreach (['work_items' => $items, 'work_item_labels' => $links] as $table => $rows) {
        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table($table)->insert($chunk);
        }
    }
    DB::statement('analyze table `work_items`, `work_item_labels`, `labels`');

    $read = [];
    DB::listen(function (QueryExecuted $query) use (&$read) {
        if (str_contains($query->sql, 'work_item_labels')) {
            $read[] = $query;
        }
    });
    $answer = QueryWorkItems::run(actor($reader), ['lean' => true, 'per_page' => 100]);
    $page = $answer->page->items();

    // the answer: every item with its labels in catalog order, as the links say
    expect($page)->toHaveCount(100)
        ->and($read)->toHaveCount(1);
    foreach ($page as $item) {
        $linked = DB::table('work_item_labels')->where('work_item_id', $item->id)->orderBy('label_id')->pluck('label_id')->all();
        expect($item->labels->modelKeys())->toBe($linked);
    }

    $plan = json_decode((string) DB::selectOne('explain format=json '.$read[0]->sql, $read[0]->bindings)->EXPLAIN, true);
    $tables = [];
    $walk = function (mixed $node) use (&$walk, &$tables): void {
        if (! is_array($node)) {
            return;
        }
        if (array_key_exists('table_name', $node)) {
            $tables[] = $node;
        }
        foreach ($node as $child) {
            $walk($child);
        }
    };
    $walk($plan);

    expect(array_column($tables, 'table_name'))->toBe(['work_item_labels'])
        ->and($tables[0]['key'] ?? null)->toBe('work_item_labels_work_item_id_label_id_unique')
        ->and($tables[0]['using_index'] ?? false)->toBeTrue();
});
