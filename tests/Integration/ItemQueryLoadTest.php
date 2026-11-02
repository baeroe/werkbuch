<?php

use App\Domain\Properties\FieldType;
use App\Domain\Ranking\Rank;
use App\Domain\Views\GroupBy;
use App\Domain\Views\SortSpec;
use App\Domain\WorkItems\Priority;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use App\Views\CatalogProperties;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
 * The item list under load (plan, Task 8; K34): 2 000 items in five projects with labels, values, parents and
 * relations. Every sort of the table "Sortierung" (one page of 100) and every grouping asks the database as often as
 * for 20 items, and each answer stays within a generous budget (the 1.5 s target is a measurement for Phase 15:
 * wall-clock checks in the shared VM and in CI wobble).
 */

it('answers every sort and grouping within budget', function () {
    $reader = User::factory()->create(['name' => 'Mara']);
    $people = User::factory()->count(4)->create()->push($reader);
    $projects = Project::factory()->count(5)->public()->create(['lead_id' => $reader->id]);
    $task = WorkItemType::query()->where('name', 'Task')->sole();
    $epic = WorkItemType::query()->where('name', 'Epic')->sole();
    $properties = [
        'effort' => Property::query()->where('key', 'effort')->sole(),
        'deadline' => Property::factory()->create(['key' => 'deadline', 'label' => 'Deadline', 'field_type' => FieldType::Date, 'settings' => []]),
        'customer' => Property::factory()->create(['key' => 'customer', 'label' => 'Kunde', 'field_type' => FieldType::Text, 'settings' => []]),
        'link' => Property::factory()->create(['key' => 'link', 'label' => 'Link', 'field_type' => FieldType::Url, 'settings' => []]),
    ];
    $task->typeProperties()->delete();
    foreach (array_values($properties) as $position => $property) {
        $task->typeProperties()->create(['property_id' => $property->id, 'required' => false, 'position' => $position]);
    }
    app()->instance(CatalogProperties::class, CatalogProperties::load());
    $labels = Label::factory()->count(6)->create()->pluck('id')->all();
    $states = Workflow::default()->states()->pluck('id')->all();
    $relates = RelationType::query()->where('built_in', 'relates')->value('id');
    $priorities = array_map(fn (Priority $p) => $p->value, Priority::ORDER);

    /** @var array<string, array{rank: ?string, number: int, epic: ?string}> $last per project */
    $last = [];
    // rows written in blocks in one transaction, as a factory per item would take minutes
    $seed = function (int $perProject) use ($projects, $people, $task, $epic, $properties, $labels, $states, $relates, $priorities, $reader, &$last) {
        DB::transaction(function () use ($perProject, $projects, $people, $task, $epic, $properties, $labels, $states, $relates, $priorities, $reader, &$last) {
            $items = $links = $values = $relations = [];
            $now = now()->utc();
            foreach ($projects as $project) {
                $at = $last[$project->id] ?? ['rank' => null, 'number' => 0, 'epic' => null];
                foreach (Rank::nBetween($at['rank'], null, $perProject) as $rank) {
                    $n = ++$at['number'];
                    $id = strtolower((string) Str::ulid());
                    $isEpic = $n % 10 === 1;
                    $items[] = [
                        'id' => $id, 'project_id' => $project->id, 'number' => $n, 'type_id' => $isEpic ? $epic->id : $task->id,
                        'title' => "Item {$n}", 'state_id' => $states[$n % count($states)], 'priority' => $priorities[$n % 5],
                        'assignee_id' => $n % 6 === 0 ? null : $people[$n % 5]->id, 'rank' => $rank, 'created_by' => $reader->id,
                        'parent_id' => $isEpic ? null : $at['epic'], 'due_date' => $n % 3 === 0 ? null : $now->copy()->addDays($n % 40)->toDateString(),
                        'start_date' => $n % 4 === 0 ? $now->copy()->subDays($n % 9)->toDateString() : null,
                        'created_at' => $now->copy()->subMinutes($n), 'updated_at' => $now->copy()->subSeconds($n * 7), 'description_version' => 1,
                    ];
                    if ($isEpic) {
                        $at['epic'] = $id;
                    }
                    foreach (array_slice($labels, $n % 4, $n % 3) as $label) {
                        $links[] = ['id' => strtolower((string) Str::ulid()), 'work_item_id' => $id, 'label_id' => $label, 'created_at' => $now, 'updated_at' => $now];
                    }
                    if (! $isEpic) {
                        foreach ([
                            'effort' => ['value_number' => sprintf('%.4F', $n % 17 / 2)],
                            'deadline' => ['value_date' => $now->copy()->addDays($n % 30)->toDateString()],
                            'customer' => ['value_string' => 'Kunde '.($n % 11)],
                            'link' => ['value_string' => "https://example.com/{$n}"],
                        ] as $key => $value) {
                            if (($n + strlen($key)) % 3 !== 0) {
                                $values[] = ['id' => strtolower((string) Str::ulid()), 'work_item_id' => $id, 'property_id' => $properties[$key]->id, 'position' => 0, 'value_number' => null, 'value_date' => null, 'value_string' => null, ...$value, 'created_at' => $now, 'updated_at' => $now];
                            }
                        }
                    }
                    if ($n % 7 === 0 && $n > 1) {
                        $relations[] = ['id' => strtolower((string) Str::ulid()), 'type_id' => $relates, 'source_id' => $id, 'target_id' => $items[count($items) - 2]['id'], 'created_at' => $now, 'updated_at' => $now];
                    }
                    $at['rank'] = $rank;
                }
                $last[$project->id] = $at;
            }
            foreach (['work_items' => $items, 'work_item_labels' => $links, 'work_item_values' => $values, 'work_item_relations' => $relations] as $table => $rows) {
                foreach (array_chunk($rows, 500) as $chunk) {
                    DB::table($table)->insert($chunk);
                }
            }
            foreach ($projects as $project) {
                $project->update(['next_number' => $last[$project->id]['number']]);
            }
        });
    };

    $sorts = [...SortSpec::CORE, ...array_map(fn (string $key) => "property:{$key}", array_keys($properties))];
    $requests = [
        ...array_merge(...array_map(fn (string $field) => [
            ["query {$field} asc", '/api/v1/work-items/query', ['sort' => ['field' => $field, 'direction' => 'asc'], 'per_page' => 100]],
            ["query {$field} desc", '/api/v1/work-items/query', ['sort' => ['field' => $field, 'direction' => 'desc'], 'per_page' => 100]],
        ], $sorts)),
        ...array_map(fn (GroupBy $by) => ["groups {$by->value}", '/api/v1/work-items/groups', ['group_by' => $by->value]], GroupBy::cases()),
        ['counts', '/api/v1/work-items/counts', ['filters' => ['all' => ['version' => 1, 'conditions' => []], 'mine' => ['version' => 1, 'conditions' => [['field' => 'assignee', 'op' => 'is', 'value' => 'me']]]]]],
    ];
    /** @return array<string, array{queries: int, seconds: float}> */
    $measure = function () use ($requests, $reader): array {
        $answers = [];
        foreach ($requests as [$name, $url, $body]) {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $start = microtime(true);
            $this->actingAs($reader)->postJson($url, $body)->assertOk();
            $answers[$name] = ['queries' => count(DB::getQueryLog()), 'seconds' => microtime(true) - $start];
            DB::disableQueryLog();
        }

        return $answers;
    };

    $seed(4);
    // the first request of a test also reads what the app keeps for the rest of it (the account, the organisation)
    $this->actingAs($reader)->postJson('/api/v1/work-items/query', [])->assertOk();
    $few = $measure();
    $seed(396);
    $many = $measure();

    expect(DB::table('work_items')->count())->toBe(2000)
        ->and(array_map(fn (array $answer) => $answer['queries'], $many))->toBe(array_map(fn (array $answer) => $answer['queries'], $few));
    foreach ($many as $name => $answer) {
        expect($answer['seconds'])->toBeLessThan(5.0, "{$name} took {$answer['seconds']} s");
    }
});
