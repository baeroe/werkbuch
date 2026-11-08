<?php

namespace Database\Seeders\Load;

use App\Domain\Ranking\Rank;
use App\Domain\WorkItems\Priority;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * 2 500 items per project, 50 000 in all, with their values, labels, 5 000 relations and their history (LoadHistory).
 * Written by bulk inserts in blocks of 1 000, without events of the app (like the demo ItemsSeeder, A86). Per project:
 * every 20th item is an epic (5 %), the first with the 40 items after it as children (numbers 2–43 without the epics 21
 * and 41), every other item with a chance of one half the child of the epic of its block of 20 (parents), so the first
 * 100 items name only parents among them; every 10th is closed and archived (10 %); the others spread over every
 * category of the workflow; 70 % have an assignee, 0–3 labels, values for `effort` (80 %) and the date, text and
 * dropdown of LoadCatalog (60 % each); 60 % a description from the pool, pointing at the item before it (the first
 * epic and the item BUSY always). The first epic of every project has the same 12 relations (EPIC_RELATIONS): nine to
 * items 2–10 of its project, three to items of other projects (some of them private), in both directions.
 *
 * @phpstan-import-type Frame from LoadCatalog
 *
 * @phpstan-type Items array{ids: list<string>, created: list<int>, people: list<string>}
 */
final class LoadItems
{
    public const PER_PROJECT = 2_500;

    public const RELATIONS = 5_000;

    /** The item with 40 comments, its number in every project (LoadContent). */
    public const BUSY = 2;

    public const BLOCK = 1_000;

    /** The children of the first epic of every project (numbers 2–43 without the epics 21 and 41). */
    public const EPIC_CHILDREN = 40;

    /**
     * The relations of the first epic of every project: [relation type, project offset (0 = its own), number of the
     * other end, whether the epic is the source].
     */
    public const EPIC_RELATIONS = [
        ['relates', 0, self::BUSY, true], ['blocks', 0, 3, true], ['relates', 0, 4, true], ['blocks', 0, 5, false], ['duplicates', 0, 6, true],
        ['tests', 0, 7, false], ['relates', 0, 8, true], ['blocks', 0, 9, true], ['relates', 0, 10, true],
        ['relates', 1, 3, true], ['blocks', 3, 4, true], ['tests', 4, 5, false],
    ];

    /** The moment the load data are about: everything happened before it. */
    public const NOW = '2026-11-01 08:00:00';

    /** Weights of the categories of an item that is not archived. */
    private const CATEGORIES = ['backlog' => 25, 'unstarted' => 20, 'started' => 25, 'completed' => 20, 'canceled' => 10];

    /** @var array<string, list<array<string, mixed>>> rows waiting for their insert, by table */
    private array $pending = [];

    private readonly LoadHistory $history;

    /** @var array<string, true> the relations so far (`type|source|target`) */
    private array $seen = [];

    /**
     * @param  Frame  $frame
     */
    public function __construct(private readonly array $frame, private readonly LoadTexts $texts)
    {
        $this->history = new LoadHistory;
    }

    /**
     * @return list<Items> per project, in the order of the frame
     */
    public function run(): array
    {
        $all = [];
        foreach ($this->frame['projects'] as $project) {
            $all[] = $this->project($project);
        }

        $this->relations($all);
        $this->flushAll();
        $this->history->flush();

        return $all;
    }

    /**
     * @param  array{id: string, identifier: string, people: list<string>, bot: string, wishes: bool, states: list<array{id: string, name: string, category: string}>}  $project
     * @return Items
     */
    private function project(array $project): array
    {
        $now = (int) strtotime(self::NOW.' UTC');
        $ids = [];
        for ($n = 1; $n <= self::PER_PROJECT; $n++) {
            $ids[] = strtolower((string) Str::ulid());
        }
        $ranks = Rank::nBetween(null, null, self::PER_PROJECT);
        $parents = $this->parents($ids);

        /** @var array<string, list<string>> $byCategory */
        $byCategory = [];
        foreach ($project['states'] as $state) {
            $byCategory[$state['category']][] = $state['id'];
        }

        $created = [];
        $epics = [];
        $others = [];

        for ($n = 1; $n <= self::PER_PROJECT; $n++) {
            $epic = $n % 20 === 1;
            $archived = $n % 10 === 0;
            $category = $archived ? (LoadRandom::chance(8) ? 'completed' : 'canceled') : self::category();
            $states = $byCategory[$category];

            $createdAt = $now - (self::PER_PROJECT - $n) * 6_000 - LoadRandom::int(0, 5_000);
            $updatedAt = min($now, $createdAt + LoadRandom::int(0, 20 * 86_400));
            $started = in_array($category, ['started', 'completed', 'canceled'], true) ? min($updatedAt, $createdAt + LoadRandom::int(3_600, 5 * 86_400)) : null;
            $closed = in_array($category, ['completed', 'canceled'], true) ? $updatedAt : null;
            $created[] = $createdAt;

            // the first epic and the item with 40 comments always (their rows compare a big and a small world, ApiLoadTest)
            $description = in_array($n, [1, self::BUSY], true) || LoadRandom::chance(6) ? $this->texts->descriptions[LoadRandom::int(0, LoadTexts::POOL - 1)] : null;
            $start = LoadRandom::int(1, 10) <= ($epic ? 9 : 3) ? $now + LoadRandom::int(-120, 60) * 86_400 : null;
            $due = LoadRandom::int(1, 10) <= ($epic ? 9 : 5) ? ($start ?? $now) + LoadRandom::int(0, 90) * 86_400 : null;

            $row = [
                'id' => $ids[$n - 1],
                'project_id' => $project['id'],
                'number' => $n,
                'type_id' => $epic ? $this->frame['types']['epic'] : $this->type($project['wishes']),
                'title' => LoadTexts::title(),
                'description' => $description === null ? null : LoadTexts::pointedAt($description, $ids[$n === 1 ? 1 : $n - 2]),
                'description_text' => $description['text'] ?? null,
                'description_version' => 1,
                'state_id' => $states[LoadRandom::int(0, count($states) - 1)],
                'resolution_id' => $closed === null ? null : $this->frame['resolutions'][$category === 'completed' ? 'completed' : 'canceled'],
                'assignee_id' => LoadRandom::chance(7) ? (LoadRandom::int(1, 100) <= 85 ? LoadRandom::pick($project['people']) : $project['bot']) : null,
                'priority' => Priority::cases()[LoadRandom::int(0, count(Priority::cases()) - 1)]->value,
                'start_date' => $start === null ? null : gmdate('Y-m-d', $start),
                'due_date' => $due === null ? null : gmdate('Y-m-d', $due),
                'parent_id' => $parents[$n - 1],
                'template_id' => null,
                'rank' => $ranks[$n - 1],
                'created_by' => LoadRandom::pick($project['people']),
                'started_at' => self::stamp($started),
                'closed_at' => self::stamp($closed),
                'archived_at' => $archived && $closed !== null ? self::stamp(min($now, $closed + 86_400)) : null,
                'created_at' => self::stamp($createdAt),
                'updated_at' => self::stamp($updatedAt),
            ];

            // an epic before every child: the children name their parent (foreign key)
            if ($epic) {
                $epics[] = $row;
            } else {
                $others[] = $row;
            }
        }

        foreach ([...$epics, ...$others] as $row) {
            $this->add('work_items', $row);
            $this->extras((string) $row['id'], (string) $row['created_at']);
            $this->history->item($row, $project, in_array($row['number'], [1, self::BUSY], true));
        }

        return ['ids' => $ids, 'created' => $created, 'people' => $project['people']];
    }

    /**
     * The parent of every item: the first epic takes the 40 items after it that are no epic (numbers 2–43); every other
     * item belongs with a chance of one half to the epic of its block of 20 (the epic 41 takes 44–60, the epic 61 takes
     * 62–80). An epic is never the child of a later one: the first 100 items of a project name only parents among them
     * (the small world of ApiLoadTest keeps them).
     *
     * @param  list<string>  $ids
     * @return list<string|null>
     */
    private function parents(array $ids): array
    {
        $parents = array_fill(0, count($ids), null);
        $children = 0;
        foreach ($ids as $index => $id) {
            if (($index + 1) % 20 === 1) {
                continue;
            }

            if ($children < self::EPIC_CHILDREN) {
                $parents[$index] = $ids[0];
                $children++;
            } elseif (LoadRandom::chance(5)) {
                $parents[$index] = $ids[intdiv($index, 20) * 20];
            }
        }

        return array_values($parents);
    }

    /** The labels and values of an item. */
    private function extras(string $item, string $at): void
    {
        $labels = $this->frame['labels'];
        foreach (LoadRandom::some($labels, LoadRandom::int(0, 3)) as $label) {
            $this->add('work_item_labels', ['id' => strtolower((string) Str::ulid()), 'work_item_id' => $item, 'label_id' => $label, 'created_at' => $at, 'updated_at' => $at]);
        }

        $properties = $this->frame['properties'];
        $value = fn (string $property, array $value) => $this->add('work_item_values', [
            'id' => strtolower((string) Str::ulid()),
            'work_item_id' => $item,
            'property_id' => $property,
            'position' => 0,
            'value_string' => null,
            'value_number' => null,
            'value_date' => null,
            'value_bool' => null,
            'value_user_id' => null,
            'value_option_id' => null,
            'value_json' => null,
            'value_text' => null,
            'created_at' => $at,
            'updated_at' => $at,
            ...$value,
        ]);

        if (LoadRandom::chance(8)) {
            $value($properties['effort'], ['value_number' => sprintf('%.4F', LoadRandom::int(1, 400) / 10)]);
        }
        if (LoadRandom::chance(6)) {
            $value($properties['deadline'], ['value_date' => gmdate('Y-m-d', (int) strtotime(self::NOW.' UTC') + LoadRandom::int(-60, 120) * 86_400)]);
        }
        if (LoadRandom::chance(6)) {
            $value($properties['note'], ['value_string' => 'Notiz '.LoadTexts::title()]);
        }
        if (LoadRandom::chance(6)) {
            $value($properties['area'], ['value_option_id' => LoadRandom::pick($this->frame['areaOptions'])]);
        }
    }

    /**
     * 5 000 relations: first the EPIC_RELATIONS of the first epic of every project, then nine in ten inside a project,
     * one in ten across two; relates, blocks, duplicates and „testet“. Each with its two history events, a minute after
     * the later of its ends.
     *
     * @param  list<Items>  $all
     */
    private function relations(array $all): void
    {
        $types = $this->frame['relationTypes'];
        $count = count($all);

        foreach (array_keys($all) as $p) {
            foreach (self::EPIC_RELATIONS as [$type, $offset, $number, $epicIsSource]) {
                $epic = [$p, 0];
                $other = [($p + $offset) % $count, $number - 1];
                $this->relate($all, $types[$type], ...($epicIsSource ? [$epic, $other] : [$other, $epic]));
            }
        }

        while (count($this->seen) < self::RELATIONS) {
            $from = LoadRandom::int(0, $count - 1);
            $to = LoadRandom::int(1, 10) === 1 ? LoadRandom::int(0, $count - 1) : $from;
            $source = LoadRandom::int(0, self::PER_PROJECT - 1);
            $target = LoadRandom::int(0, self::PER_PROJECT - 1);
            $roll = LoadRandom::int(1, 10);
            $type = match (true) {
                $roll <= 5 => $types['relates'],
                $roll <= 8 => $types['blocks'],
                $roll <= 9 => $types['duplicates'],
                default => $types['tests'],
            };

            $this->relate($all, $type, [$from, $source], [$to, $target]);
        }
    }

    /**
     * A relation from the item `$source` to the item `$target` (each [project, index]), with its history; never on
     * itself, never twice, a symmetric type also not the other way round.
     *
     * @param  list<Items>  $all
     * @param  array{0: int, 1: int}  $source
     * @param  array{0: int, 1: int}  $target
     */
    private function relate(array $all, string $type, array $source, array $target): void
    {
        $from = $all[$source[0]]['ids'][$source[1]];
        $to = $all[$target[0]]['ids'][$target[1]];
        $key = "{$type}|{$from}|{$to}";
        $back = "{$type}|{$to}|{$from}";
        if ($from === $to || isset($this->seen[$key]) || ($type === $this->frame['relationTypes']['relates'] && isset($this->seen[$back]))) {
            return;
        }

        $this->seen[$key] = true;
        $at = max($all[$source[0]]['created'][$source[1]], $all[$target[0]]['created'][$target[1]]) + 60;
        $this->add('work_item_relations', ['id' => strtolower((string) Str::ulid()), 'type_id' => $type, 'source_id' => $from, 'target_id' => $to, 'created_at' => self::stamp($at), 'updated_at' => self::stamp($at)]);
        $this->history->relation(
            $type,
            ['id' => $from, 'project' => $this->frame['projects'][$source[0]]['id']],
            ['id' => $to, 'project' => $this->frame['projects'][$target[0]]['id']],
            LoadRandom::pick($all[$source[0]]['people']),
            $at,
        );
    }

    private static function category(): string
    {
        $roll = LoadRandom::int(1, array_sum(self::CATEGORIES));
        foreach (self::CATEGORIES as $category => $weight) {
            $roll -= $weight;
            if ($roll <= 0) {
                return $category;
            }
        }

        return 'backlog';
    }

    private function type(bool $wishes): string
    {
        $roll = LoadRandom::int(1, 100);

        return match (true) {
            $roll <= 55 => $this->frame['types']['task'],
            $roll <= 85 => $this->frame['types']['bug'],
            default => $wishes ? $this->frame['types']['wish'] : $this->frame['types']['task'],
        };
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private function add(string $table, array $row): void
    {
        $this->pending[$table][] = $row;
        if (count($this->pending[$table]) >= self::BLOCK) {
            $this->flush($table);
        }
    }

    /** Writes the waiting rows of a table; the items first, which every other row names (foreign key). */
    private function flush(string $table): void
    {
        if ($table !== 'work_items') {
            $this->flush('work_items');
        }

        if (($this->pending[$table] ?? []) !== []) {
            DB::table($table)->insert($this->pending[$table]);
        }
        $this->pending[$table] = [];
    }

    private function flushAll(): void
    {
        foreach (array_keys($this->pending) as $table) {
            $this->flush($table);
        }
    }

    public static function stamp(?int $at): ?string
    {
        return $at === null ? null : gmdate('Y-m-d H:i:s', $at);
    }
}
