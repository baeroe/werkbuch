<?php

namespace Database\Seeders\Demo;

use App\Domain\Ranking\Rank;
use App\Domain\WorkItems\ItemKey;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemType;
use App\RichText\Document;
use App\Support\ItemValues;
use App\Support\RichTextRules;
use Carbon\CarbonImmutable;
use Database\Seeders\Demo\Texts\DemoTexts;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * The work items of WEB, APP and OPS and the relations between them, every row of the clickdummy seed
 * (src/api/seed/items.ts; `ItemsSeederTest` reads that file and compares key by key). A row says what is special about
 * an item, the rest follows from the project (workflow, creator) and the state (`started_at`, `closed_at`, resolution).
 * Written directly, without events, like the other demo seeders (A86); the history is the ActivitySeeder's.
 *
 * Safe to run again, and it never touches an item that exists (K13): it creates the (project, number) pairs that are
 * missing and nothing else, so a second run cannot put items back on the states of a workflow the project left.
 * A row holds the structure both languages share; the title, the description, the steps of WEB-47 and the client's
 * ticket come from DemoTexts (`item.<KEY>.title|description`, A443). Catalog entries are found by the keys of the
 * CatalogSeeder through their text in the language of the demo: states, types and labels by name, options by label;
 * resolutions by their (English) label, people by handle. A description is read as Markdown with the lookup of its
 * creator (RichTextRules::context()), as the API reads one: `@mara` becomes a mention and `WEB-42` a reference, if the
 * creator may mention the person and sees the item (items come in the order of their numbers, so an item named in a
 * text exists by then). An item seeded before Phase 7 keeps its plain text until the database is set up anew (K13).
 * `tpl` (the template of an automated item) is the TemplatesSeeder's; the comments and files are the CommentsSeeder's
 * and the AttachmentsSeeder's.
 */
class ItemsSeeder extends Seeder
{
    use WithoutModelEvents;

    /** The year the demo plays in and the zone its times are given in (the clickdummy's `helpers.ts`). */
    private const YEAR = 2026;

    private const ZONE = 'Europe/Berlin';

    /** States in which an item has been started without a time of its own: `started_at` is its start date, at 10:00. */
    private const OPEN_STARTED = ['progress', 'review', 'approval', 'pending'];

    /** The resolutions a row names besides the two defaults; a closed row without one gets the default of its category. */
    private const RESOLUTIONS = ['duplicate' => 'Duplicate', 'cannot' => 'Cannot reproduce'];

    /**
     * The relations (rel_1 … rel_8 of the clickdummy): type (`blocks`, `duplicates` and `relates` are the built-in
     * ones, `tests` the CatalogSeeder's own), source, target. A relation arises a minute after the later of its two
     * items.
     *
     * @var list<array{0: string, 1: string, 2: string}>
     */
    public const RELATIONS = [
        // the demo's blocker: the mail limit holds up the contact form fix
        ['blocks', 'OPS-12', 'WEB-47'],
        ['tests', 'WEB-54', 'WEB-47'],
        ['blocks', 'WEB-45', 'WEB-49'],
        ['blocks', 'APP-16', 'APP-18'],
        ['duplicates', 'APP-21', 'APP-17'],
        ['relates', 'WEB-41', 'WEB-32'],
        ['relates', 'APP-9', 'APP-10'],
        ['relates', 'OPS-14', 'OPS-8'],
    ];

    /** Who creates the items of a project unless a row says otherwise: its lead. */
    private const CREATORS = ['WEB' => 'ida', 'APP' => 'theo', 'OPS' => 'jonas'];

    /** @var array<string, User> the creators of descriptions by ID, read once */
    private array $writers = [];

    /** @var Collection<string, string> handle → id */
    private Collection $people;

    /** @var Collection<string, string> name → id */
    private Collection $types;

    /** @var Collection<string, string> name → id */
    private Collection $labels;

    /** @var Collection<string, string> label → id */
    private Collection $resolutions;

    /** @var Collection<string, Property> by key, with their options */
    private Collection $properties;

    /** @var Collection<string, string> the states of the workflow of the project at hand, name → id */
    private Collection $states;

    /** The initial state of that workflow: where an item lands whose state name the workflow does not have (any more). */
    private string $initialState;

    public function run(): void
    {
        $this->items();
        $this->relations();
    }

    /**
     * The name of a state in the language of the demo, by its key (`backlog`, `todo`, `progress`, `review`, `approval`,
     * `pending`, `done`, `cancelled`; `pending` is the shipped workflow's, `review` and `approval` the agency's).
     */
    public static function state(string $key): string
    {
        return DemoTexts::get("catalog.state.{$key}");
    }

    /**
     * A wall-clock time in the organization's zone as an instant (UTC), as the clickdummy's `at()`: `$when` is
     * `MM-DD` or `MM-DD HH:mm` (09:00 without a time), `$seconds` shifts it a little.
     */
    public static function at(string $when, int $seconds = 0): CarbonImmutable
    {
        [$date, $time] = array_pad(explode(' ', $when), 2, '09:00');

        return CarbonImmutable::parse(self::YEAR."-{$date} {$time}", self::ZONE)->utc()->addSeconds($seconds);
    }

    /**
     * The item of a key (`WEB-47`), if the demo project has it.
     */
    public static function find(string $key): ?WorkItem
    {
        [$identifier, $number] = explode('-', $key);

        return WorkItem::query()
            ->whereIn('project_id', Project::query()->where('identifier', $identifier)->select('id'))
            ->where('number', (int) $number)->first();
    }

    private function items(): void
    {
        $this->people = User::query()->pluck('id', 'handle');
        $this->types = WorkItemType::query()->pluck('id', 'name');
        $this->labels = Label::query()->pluck('id', 'name');
        $this->resolutions = Resolution::query()->pluck('id', 'label');
        $this->properties = Property::query()->with('options')->get()->keyBy('key');

        foreach (['WEB', 'APP', 'OPS'] as $identifier) {
            $project = Project::query()->where('identifier', $identifier)->sole();
            // the states of the workflow the project has now; a name it lacks falls back to the initial state
            $this->states = WorkflowState::query()->where('workflow_id', $project->workflow_id)->pluck('id', 'name');
            $this->initialState = (string) Workflow::query()->whereKey($project->workflow_id)->value('initial_state_id');
            $rows = array_values(array_filter(self::rows(), fn (array $row) => str_starts_with($row['key'], "{$identifier}-")));
            usort($rows, fn (array $a, array $b) => self::number($a['key']) <=> self::number($b['key']));
            // the manual order follows the numbers; an item a later run adds takes the rank of its place in the list
            $ranks = Rank::nBetween(null, null, count($rows));
            // an item somebody deleted stays deleted: its number is never given out again (spec 4.8)
            $deleted = self::deletedNumbers($project);

            foreach ($rows as $index => $row) {
                $number = self::number($row['key']);
                if (in_array($number, $deleted, true) || WorkItem::query()->where('project_id', $project->id)->where('number', $number)->exists()) {
                    continue;
                }

                // one transaction each: an item without its labels or values would stay so for good (a rerun skips it, K13)
                DB::transaction(fn () => $this->create($project, $row, $ranks[$index]));
            }

            // the counter is the highest number, gaps included (APP-20 and APP-23 do not exist); never lowered
            $highest = max([0, ...array_map(fn (array $row) => self::number($row['key']), $rows)]);
            Project::query()->whereKey($project->id)->where('next_number', '<', $highest)->toBase()->update(['next_number' => $highest]);
        }
    }

    /**
     * The numbers of the items deleted in the project (`work_item.deleted` keeps the key as it read then).
     *
     * @return list<int>
     */
    private static function deletedNumbers(Project $project): array
    {
        $numbers = Event::query()->where('project_id', $project->id)->where('type', EventType::WorkItemDeleted)->get()
            ->map(fn (Event $event) => ItemKey::parse((string) ($event->meta['key'] ?? ''))['number'] ?? null)
            ->filter()->all();

        return array_values($numbers);
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private function create(Project $project, array $row, string $rank): void
    {
        $number = self::number($row['key']);
        $closed = in_array($row['state'], ['done', 'cancelled'], true);
        $created = str_contains($row['created'], ' ') ? $row['created'] : sprintf('%s 09:%02d', $row['created'], ($number * 7) % 50 + 5);
        $startedAt = isset($row['started'])
            ? self::at(str_contains($row['started'], ' ') ? $row['started'] : "{$row['started']} 10:00")
            : (in_array($row['state'], self::OPEN_STARTED, true) ? self::at(($row['start'] ?? substr($row['created'], 0, 5)).' 10:00') : null);
        $closedAt = isset($row['closed']) ? self::at($row['closed']) : null;
        $stamps = array_filter([self::at($created), $startedAt, $closedAt]);
        $updatedAt = isset($row['updated']) ? self::at($row['updated']) : max($stamps);

        $by = $row['by'] ?? self::CREATORS[$project->identifier];
        $creator = $this->people[$by] ?? throw new RuntimeException("No account @{$by}.");
        $description = DemoTexts::has("item.{$row['key']}.description")
            ? $this->text(DemoTexts::get("item.{$row['key']}.description"), $project, $creator)
            : null;
        $category = $row['state'] === 'done' ? 'completed' : 'canceled';

        // read before anything is written: an unknown option throws before the item exists
        $values = $this->values($row['v'] ?? []);

        $item = new WorkItem;
        $item->forceFill([
            'project_id' => $project->id,
            'number' => $number,
            'type_id' => $this->types[DemoTexts::get("catalog.type.{$row['type']}.name")],
            'title' => DemoTexts::get("item.{$row['key']}.title"),
            'description' => $description?->toJson(),
            'description_text' => $description?->toText(),
            'description_version' => 1,
            'state_id' => $this->states[self::state($row['state'])] ?? $this->initialState,
            'resolution_id' => $closed ? $this->resolution($row, $category) : null,
            'assignee_id' => isset($row['a']) ? $this->people[$row['a']] : null,
            'priority' => $row['p'] ?? 'none',
            'start_date' => isset($row['start']) ? self::YEAR."-{$row['start']}" : null,
            'due_date' => isset($row['due']) ? self::YEAR."-{$row['due']}" : null,
            'parent_id' => isset($row['parent']) ? self::find($row['parent'])?->id : null,
            'rank' => $rank,
            'created_by' => $creator,
            'started_at' => $startedAt,
            'closed_at' => $closedAt,
            'archived_at' => isset($row['archived']) ? self::at($row['archived']) : null,
            'created_at' => self::at($created),
            'updated_at' => $updatedAt,
        ])->save();

        $item->labels()->sync(array_map(fn (string $label) => $this->labels[DemoTexts::get("catalog.label.{$label}")], $row['l'] ?? []));
        ItemValues::store($item, $values, []);
    }

    /**
     * The values as ItemValues::store() takes them: a dropdown by the id of its option (found by label), a person by
     * id (found by handle), rich text as the document the editor would store.
     *
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private function values(array $values): array
    {
        $stored = [];

        foreach ($values as $key => $value) {
            $property = $this->properties[$key] ?? throw new RuntimeException("No property {$key}.");
            $stored[$key] = match ($property->field_type->value) {
                'dropdown' => ($property->options->firstWhere('label', DemoTexts::get("catalog.property.{$key}.option.{$value}")) ?? throw new RuntimeException("No option {$value} of {$key}."))->id,
                'member' => $this->people[$value],
                'rich_text' => Document::fromJson($value)->toJson(),
                default => $value,
            };
        }

        return $stored;
    }

    /**
     * The resolution of a closed row: the one it names (Duplicate, Cannot reproduce), else the default of its category
     * (Done for completed, Won't do for canceled; the rows `res: done` and `res: wontdo` say just that).
     *
     * @param  array<string, mixed>  $row
     */
    private function resolution(array $row, string $category): ?string
    {
        $named = self::RESOLUTIONS[$row['res'] ?? ''] ?? null;

        return ($named === null ? null : $this->resolutions[$named] ?? null) ?? Resolution::query()->where('default_for', $category)->value('id');
    }

    /** A description, Markdown as its creator would send it (paragraphs separated by blank lines). */
    private function text(string $text, Project $project, string $creator): Document
    {
        // each creator read once (T14-M5)
        $this->writers[$creator] ??= User::query()->findOrFail($creator);

        return Document::fromMarkdown($text, RichTextRules::context($project, $this->writers[$creator], null));
    }

    /**
     * @return array{type: 'paragraph', content: list<array{type: 'text', text: string}>}
     */
    private static function paragraph(string $text): array
    {
        return ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $text]]];
    }

    private function relations(): void
    {
        $types = RelationType::query()->get();
        $of = fn (string $name) => $name === 'tests' ? $types->firstWhere('name', DemoTexts::get('catalog.relation.tests.name')) : $types->firstWhere('built_in', $name);

        foreach (self::RELATIONS as [$type, $source, $target]) {
            $from = self::find($source);
            $to = self::find($target);
            $relationType = $of($type);
            if ($from === null || $to === null || $relationType === null) {
                continue;
            }

            // arises a minute after the later of the two items
            $when = max($from->created_at ?? now(), $to->created_at ?? now())->copy()->addMinute();
            $relation = WorkItemRelation::query()->firstOrNew(['type_id' => $relationType->id, 'source_id' => $from->id, 'target_id' => $to->id]);
            if (! $relation->exists) {
                $relation->forceFill(['created_at' => $when, 'updated_at' => $when])->save();
            }
        }
    }

    private static function number(string $key): int
    {
        return (int) substr($key, (int) strpos($key, '-') + 1);
    }

    /**
     * Every row of the clickdummy seed, in its order: the structure both languages share. The steps of WEB-47 and the
     * client's ticket of APP-15 are read in the language of the demo; titles and descriptions are not part of a row.
     *
     * @return list<array<string, mixed>>
     */
    public static function rows(): array
    {
        $web47Steps = [
            'type' => 'doc',
            'content' => [
                self::paragraph(DemoTexts::get('item.WEB-47.steps.intro')),
                ['type' => 'orderedList', 'attrs' => ['start' => 1], 'content' => array_map(
                    fn (int $step) => ['type' => 'listItem', 'content' => [self::paragraph(DemoTexts::get("item.WEB-47.steps.{$step}"))]],
                    [1, 2, 3],
                )],
            ],
        ];

        return [
            // WEB
            [
                'key' => 'WEB-3',
                'type' => 'task',
                'state' => 'done',
                'p' => 'medium',
                'a' => 'sven',
                'l' => ['backend'],
                'by' => 'jonas',
                'created' => '08-24',
                'started' => '08-24 10:00',
                'closed' => '08-28 16:10',
            ],
            [
                'key' => 'WEB-8',
                'type' => 'task',
                'state' => 'done',
                'p' => 'high',
                'a' => 'ida',
                'l' => ['ux', 'design'],
                'created' => '08-31',
                'started' => '09-01 09:30',
                'closed' => '09-16 17:00',
                'archived' => '10-16 03:00',
            ],
            ['key' => 'WEB-11', 'type' => 'task', 'state' => 'done', 'p' => 'low', 'a' => 'sven', 'by' => 'mara', 'created' => '09-04', 'closed' => '09-11 12:30'],
            [
                'key' => 'WEB-14',
                'type' => 'bug',
                'state' => 'cancelled',
                'res' => 'cannot',
                'p' => 'low',
                'a' => 'sven',
                'v' => ['environment' => 'local'],
                'created' => '09-07',
                'closed' => '09-09 10:15',
                'archived' => '10-09 03:00',
            ],
            [
                'key' => 'WEB-17',
                'type' => 'task',
                'state' => 'done',
                'p' => 'medium',
                'a' => 'lene',
                'l' => ['design'],
                'v' => ['customer' => 'nordlicht'],
                'created' => '09-14',
                'started' => '09-15 09:00',
                'closed' => '10-02 15:45',
            ],
            ['key' => 'WEB-21', 'type' => 'task', 'state' => 'done', 'p' => 'medium', 'a' => 'ida', 'created' => '09-21', 'started' => '09-22 09:00', 'closed' => '10-02 11:20'],
            [
                'key' => 'WEB-24',
                'type' => 'task',
                'state' => 'done',
                'p' => 'low',
                'a' => 'jonas',
                'l' => ['performance'],
                'v' => ['effort' => 2],
                'created' => '09-28',
                'started' => '10-05 10:00',
                'closed' => '10-06 17:05',
            ],
            ['key' => 'WEB-27', 'type' => 'task', 'state' => 'done', 'p' => 'medium', 'a' => 'ida', 'v' => ['customer' => 'nordlicht'], 'created' => '09-30', 'closed' => '10-08 14:00'],
            [
                'key' => 'WEB-29',
                'type' => 'task',
                'state' => 'done',
                'p' => 'high',
                'a' => 'jonas',
                'l' => ['backend'],
                'v' => ['effort' => 5],
                'created' => '09-30',
                'started' => '10-01 09:00',
                'closed' => '10-09 18:30',
            ],
            [
                'key' => 'WEB-30',
                'type' => 'epic',
                'state' => 'progress',
                'start' => '10-01',
                'due' => '11-15',
                'v' => ['target_quarter' => 'q4_2026'],
                'created' => '10-01 09:00',
                'started' => '10-01 10:00',
            ],
            [
                'key' => 'WEB-31',
                'type' => 'task',
                'state' => 'done',
                'p' => 'high',
                'a' => 'ida',
                'l' => ['ux'],
                'parent' => 'WEB-30',
                'v' => ['customer' => 'nordlicht'],
                'created' => '10-01 09:20',
                'started' => '10-02 09:00',
                'closed' => '10-06 16:00',
            ],
            ['key' => 'WEB-32', 'type' => 'task', 'state' => 'done', 'p' => 'medium', 'a' => 'ida', 'created' => '10-02', 'closed' => '10-08 10:30'],
            [
                'key' => 'WEB-33',
                'type' => 'task',
                'state' => 'done',
                'p' => 'medium',
                'a' => 'lene',
                'l' => ['design'],
                'parent' => 'WEB-30',
                'created' => '10-02',
                'started' => '10-02 14:00',
                'closed' => '10-09 12:15',
            ],
            [
                'key' => 'WEB-34',
                'type' => 'task',
                'state' => 'done',
                'p' => 'medium',
                'a' => 'jonas',
                'l' => ['backend'],
                'due' => '10-07',
                'by' => 'automation',
                'created' => '10-05 09:00',
                'started' => '10-06 09:00',
                'closed' => '10-06 17:40',
            ],
            [
                'key' => 'WEB-35',
                'type' => 'task',
                'state' => 'done',
                'p' => 'high',
                'a' => 'ida',
                'l' => ['ux'],
                'parent' => 'WEB-30',
                'v' => ['effort' => 6.5],
                'created' => '10-06',
                'started' => '10-08 09:00',
                'closed' => '10-14 15:30',
            ],
            ['key' => 'WEB-36', 'type' => 'task', 'state' => 'cancelled', 'res' => 'wontdo', 'p' => 'low', 'a' => 'jonas', 'parent' => 'WEB-30', 'created' => '10-06', 'closed' => '10-12 11:00'],
            ['key' => 'WEB-37', 'type' => 'task', 'state' => 'backlog', 'p' => 'low', 'a' => 'sven', 'l' => ['forms'], 'by' => 'mara', 'created' => '10-07'],
            [
                'key' => 'WEB-38',
                'type' => 'task',
                'state' => 'done',
                'p' => 'medium',
                'a' => 'jonas',
                'l' => ['backend'],
                'due' => '10-14',
                'by' => 'automation',
                'created' => '10-12 09:00',
                'started' => '10-13 09:00',
                'closed' => '10-13 16:20',
            ],
            [
                'key' => 'WEB-39',
                'type' => 'task',
                'state' => 'done',
                'p' => 'medium',
                'a' => 'jonas',
                'l' => ['backend'],
                'start' => '10-19',
                'due' => '10-26',
                'parent' => 'WEB-30',
                'v' => ['effort' => 4],
                'created' => '10-13',
                'started' => '10-19 10:00',
                'closed' => '10-27 16:20',
            ],
            [
                'key' => 'WEB-40',
                'type' => 'bug',
                'state' => 'done',
                'p' => 'low',
                'a' => 'lene',
                'parent' => 'WEB-30',
                'v' => ['environment' => 'prod', 'browser' => 'Safari 17 (macOS)'],
                'by' => 'mara',
                'created' => '10-14',
                'closed' => '10-23 14:10',
            ],
            [
                'key' => 'WEB-41',
                'type' => 'task',
                'state' => 'progress',
                'p' => 'high',
                'a' => 'ida',
                'start' => '10-22',
                'due' => '10-27',
                'created' => '10-14',
                'started' => '10-22 09:45',
                'updated' => '10-24 12:00',
            ],
            [
                'key' => 'WEB-42',
                'type' => 'task',
                'state' => 'progress',
                'p' => 'high',
                'a' => 'ida',
                'start' => '10-26',
                'due' => '10-30',
                'parent' => 'WEB-30',
                'v' => ['customer' => 'nordlicht', 'effort' => 8],
                'created' => '10-15 10:05',
                'started' => '10-26 10:00',
            ],
            ['key' => 'WEB-43', 'type' => 'task', 'state' => 'todo', 'p' => 'medium', 'a' => 'lene', 'l' => ['design'], 'due' => '11-04', 'parent' => 'WEB-30', 'created' => '10-16'],
            [
                'key' => 'WEB-44',
                'type' => 'task',
                'state' => 'todo',
                'p' => 'medium',
                'a' => 'kira',
                'l' => ['a11y'],
                'due' => '11-03',
                'by' => 'mara',
                'created' => '10-16',
            ],
            [
                'key' => 'WEB-45',
                'type' => 'task',
                'state' => 'pending',
                'p' => 'medium',
                'v' => ['customer' => 'nordlicht'],
                'created' => '10-17',
                'started' => '10-20 09:00',
                'updated' => '10-27 15:00',
            ],
            [
                'key' => 'WEB-46',
                'type' => 'task',
                'state' => 'done',
                'p' => 'medium',
                'a' => 'jonas',
                'l' => ['backend'],
                'due' => '10-21',
                'by' => 'automation',
                'created' => '10-19 09:00',
                'started' => '10-20 09:00',
                'closed' => '10-20 15:00',
            ],
            [
                'key' => 'WEB-47',
                'type' => 'bug',
                'state' => 'progress',
                'p' => 'urgent',
                'a' => 'jonas',
                'l' => ['forms', 'production'],
                'start' => '10-27',
                'due' => '10-31',
                'v' => ['customer' => 'nordlicht', 'effort' => 3.5, 'environment' => 'prod', 'browser' => 'Safari 18 (iOS)', 'steps' => $web47Steps],
                'created' => '10-20 11:30',
                'started' => '10-27 09:15',
                'updated' => '10-27 10:20',
            ],
            [
                'key' => 'WEB-48',
                'type' => 'task',
                'state' => 'todo',
                'p' => 'high',
                'a' => 'lene',
                'l' => ['ux'],
                'parent' => 'WEB-30',
                'created' => '10-21',
                'updated' => '10-27 16:30',
            ],
            ['key' => 'WEB-49', 'type' => 'task', 'state' => 'backlog', 'p' => 'medium', 'parent' => 'WEB-30', 'v' => ['customer' => 'nordlicht'], 'created' => '10-22'],
            ['key' => 'WEB-50', 'type' => 'task', 'state' => 'todo', 'p' => 'medium', 'created' => '10-22'],
            ['key' => 'WEB-51', 'type' => 'task', 'state' => 'backlog', 'p' => 'low', 'created' => '10-23'],
            ['key' => 'WEB-52', 'type' => 'task', 'state' => 'progress', 'p' => 'medium', 'a' => 'jonas', 'l' => ['backend'], 'due' => '10-28', 'by' => 'automation', 'created' => '10-26 09:00', 'started' => '10-27 09:00'],
            [
                'key' => 'WEB-53',
                'type' => 'task',
                'state' => 'todo',
                'p' => 'low',
                'a' => 'kira',
                'l' => ['seo'],
                'due' => '11-01',
                'by' => 'mara',
                'created' => '10-26',
            ],
            ['key' => 'WEB-54', 'type' => 'task', 'state' => 'todo', 'p' => 'medium', 'a' => 'lene', 'l' => ['forms'], 'created' => '10-26'],
            ['key' => 'WEB-55', 'type' => 'task', 'state' => 'backlog', 'created' => '10-27'],
            [
                'key' => 'WEB-56',
                'type' => 'task',
                'state' => 'backlog',
                'p' => 'low',
                'a' => 'mara',
                'l' => ['performance'],
                'created' => '10-27',
            ],
            // APP
            ['key' => 'APP-1', 'type' => 'task', 'state' => 'done', 'p' => 'medium', 'a' => 'theo', 'created' => '07-06', 'closed' => '07-10 15:00'],
            [
                'key' => 'APP-2',
                'type' => 'task',
                'state' => 'done',
                'p' => 'high',
                'a' => 'mara',
                'v' => ['customer' => 'hafenkontor'],
                'by' => 'mara',
                'created' => '07-08',
                'started' => '07-09 09:00',
                'closed' => '07-24 11:00',
            ],
            [
                'key' => 'APP-3',
                'type' => 'task',
                'state' => 'done',
                'p' => 'low',
                'a' => 'lene',
                'l' => ['design'],
                'created' => '08-03',
                'started' => '08-04 09:00',
                'closed' => '08-14 16:30',
                'archived' => '09-13 03:00',
            ],
            ['key' => 'APP-4', 'type' => 'task', 'state' => 'done', 'p' => 'medium', 'a' => 'theo', 'by' => 'automation', 'created' => '09-07 09:00', 'started' => '09-08 09:00', 'closed' => '09-18 12:00'],
            [
                'key' => 'APP-5',
                'type' => 'epic',
                'state' => 'progress',
                'start' => '10-20',
                'due' => '12-20',
                'v' => ['target_quarter' => 'q4_2026', 'customer' => 'hafenkontor'],
                'created' => '10-02',
                'started' => '10-20 09:00',
            ],
            [
                'key' => 'APP-6',
                'type' => 'task',
                'state' => 'done',
                'p' => 'high',
                'a' => 'jonas',
                'parent' => 'APP-5',
                'v' => ['effort' => 10],
                'created' => '10-06',
                'started' => '10-12 09:00',
                'closed' => '10-22 15:40',
            ],
            [
                'key' => 'APP-7',
                'type' => 'task',
                'state' => 'done',
                'p' => 'medium',
                'a' => 'lene',
                'l' => ['ux'],
                'parent' => 'APP-5',
                'created' => '10-06',
                'started' => '10-14 09:00',
                'closed' => '10-24 13:20',
            ],
            ['key' => 'APP-8', 'type' => 'task', 'state' => 'progress', 'p' => 'medium', 'a' => 'theo', 'by' => 'automation', 'created' => '10-05 09:00', 'started' => '10-26 09:00'],
            [
                'key' => 'APP-9',
                'type' => 'task',
                'state' => 'review',
                'p' => 'medium',
                'a' => 'lene',
                'parent' => 'APP-5',
                'v' => ['effort' => 6],
                'created' => '10-08',
                'started' => '10-21 09:00',
            ],
            [
                'key' => 'APP-10',
                'type' => 'bug',
                'state' => 'progress',
                'p' => 'urgent',
                'a' => 'jonas',
                'l' => ['production'],
                'start' => '10-27',
                'due' => '10-30',
                'parent' => 'APP-5',
                'v' => ['customer' => 'hafenkontor', 'effort' => 3, 'environment' => 'prod', 'browser' => 'Android 14'],
                'created' => '10-22',
                'started' => '10-27 11:00',
            ],
            ['key' => 'APP-11', 'type' => 'task', 'state' => 'todo', 'p' => 'medium', 'a' => 'jonas', 'parent' => 'APP-5', 'v' => ['customer' => 'hafenkontor'], 'created' => '10-12'],
            [
                'key' => 'APP-12',
                'type' => 'task',
                'state' => 'review',
                'p' => 'medium',
                'a' => 'lene',
                'parent' => 'APP-5',
                'created' => '10-14',
                'started' => '10-23 09:00',
                'updated' => '10-27 17:15',
            ],
            ['key' => 'APP-13', 'type' => 'task', 'state' => 'backlog', 'p' => 'low', 'parent' => 'APP-5', 'created' => '10-14'],
            ['key' => 'APP-14', 'type' => 'task', 'state' => 'todo', 'p' => 'medium', 'a' => 'mara', 'parent' => 'APP-5', 'created' => '10-15'],
            [
                'key' => 'APP-15',
                'type' => 'wish',
                'state' => 'approval',
                'p' => 'medium',
                'a' => 'theo',
                'v' => ['customer' => 'hafenkontor', 'ticket_url' => DemoTexts::get('item.APP-15.ticket_url'), 'approved' => false, 'reviewer' => 'theo'],
                'by' => 'mara',
                'created' => '10-16',
                'started' => '10-24 10:00',
            ],
            ['key' => 'APP-16', 'type' => 'task', 'state' => 'todo', 'p' => 'medium', 'a' => 'theo', 'due' => '11-03', 'created' => '10-19'],
            [
                'key' => 'APP-17',
                'type' => 'bug',
                'state' => 'progress',
                'p' => 'high',
                'a' => 'jonas',
                'l' => ['production'],
                'start' => '10-27',
                'due' => '10-29',
                'v' => ['customer' => 'hafenkontor', 'effort' => 2.5, 'environment' => 'prod'],
                'created' => '10-20',
                'started' => '10-27 13:00',
            ],
            ['key' => 'APP-18', 'type' => 'task', 'state' => 'review', 'p' => 'medium', 'a' => 'mara', 'due' => '10-28', 'created' => '10-21', 'started' => '10-26 09:00'],
            ['key' => 'APP-19', 'type' => 'wish', 'state' => 'backlog', 'p' => 'low', 'v' => ['customer' => 'moos', 'approved' => false, 'reviewer' => 'theo'], 'by' => 'mara', 'created' => '10-22'],
            [
                'key' => 'APP-21',
                'type' => 'bug',
                'state' => 'cancelled',
                'res' => 'duplicate',
                'p' => 'high',
                'a' => 'jonas',
                'v' => ['environment' => 'prod', 'customer' => 'hafenkontor'],
                'created' => '10-23',
                'closed' => '10-23 17:00',
            ],
            ['key' => 'APP-22', 'type' => 'bug', 'state' => 'backlog', 'p' => 'medium', 'v' => ['environment' => 'staging', 'browser' => 'iPhone SE'], 'created' => '10-26'],
            [
                'key' => 'APP-24',
                'type' => 'task',
                'state' => 'backlog',
                'p' => 'medium',
                'a' => 'mara',
                'created' => '10-27 10:00',
            ],
            // OPS
            [
                'key' => 'OPS-3',
                'type' => 'epic',
                'state' => 'progress',
                'start' => '09-01',
                'due' => '10-31',
                'v' => ['target_quarter' => 'q4_2026'],
                'created' => '08-28',
                'started' => '09-01 09:00',
            ],
            ['key' => 'OPS-4', 'type' => 'task', 'state' => 'done', 'p' => 'medium', 'a' => 'jonas', 'parent' => 'OPS-3', 'created' => '08-28', 'started' => '08-29 09:00', 'closed' => '09-04 16:00'],
            [
                'key' => 'OPS-5',
                'type' => 'task',
                'state' => 'done',
                'p' => 'high',
                'a' => 'jonas',
                'l' => ['backend'],
                'parent' => 'OPS-3',
                'created' => '08-28',
                'started' => '09-02 09:00',
                'closed' => '09-11 17:30',
            ],
            [
                'key' => 'OPS-6',
                'type' => 'task',
                'state' => 'done',
                'p' => 'high',
                'a' => 'jonas',
                'parent' => 'OPS-3',
                'v' => ['effort' => 12],
                'created' => '09-02',
                'started' => '09-08 09:00',
                'closed' => '09-18 14:00',
            ],
            ['key' => 'OPS-7', 'type' => 'task', 'state' => 'done', 'p' => 'high', 'a' => 'mara', 'parent' => 'OPS-3', 'created' => '09-02', 'started' => '09-15 09:00', 'closed' => '09-25 11:45'],
            ['key' => 'OPS-8', 'type' => 'task', 'state' => 'done', 'p' => 'medium', 'a' => 'jonas', 'parent' => 'OPS-3', 'created' => '09-09', 'started' => '09-24 09:00', 'closed' => '10-01 16:20'],
            [
                'key' => 'OPS-9',
                'type' => 'bug',
                'state' => 'done',
                'p' => 'high',
                'a' => 'jonas',
                'l' => ['production'],
                'parent' => 'OPS-3',
                'v' => ['environment' => 'prod', 'effort' => 1.5],
                'created' => '10-02',
                'closed' => '10-07 10:10',
            ],
            ['key' => 'OPS-10', 'type' => 'task', 'state' => 'done', 'p' => 'medium', 'a' => 'kira', 'parent' => 'OPS-3', 'created' => '10-02', 'started' => '10-12 09:00', 'closed' => '10-13 13:00'],
            ['key' => 'OPS-11', 'type' => 'task', 'state' => 'done', 'p' => 'high', 'a' => 'mara', 'parent' => 'OPS-3', 'created' => '10-08', 'started' => '10-20 09:00', 'closed' => '10-27 14:00'],
            [
                'key' => 'OPS-12',
                'type' => 'task',
                'state' => 'todo',
                'p' => 'high',
                'a' => 'jonas',
                'due' => '10-30',
                'parent' => 'OPS-3',
                'v' => ['effort' => 1.5],
                'by' => 'mara',
                'created' => '10-20 14:00',
                'updated' => '10-26 16:30',
            ],
            [
                'key' => 'OPS-13',
                'type' => 'task',
                'state' => 'done',
                'p' => 'medium',
                'a' => 'kira',
                'parent' => 'OPS-3',
                'created' => '10-14',
                'started' => '10-16 09:00',
                'closed' => '10-21 12:30',
            ],
            ['key' => 'OPS-14', 'type' => 'task', 'state' => 'backlog', 'p' => 'medium', 'a' => 'mara', 'created' => '10-22'],
            [
                'key' => 'OPS-15',
                'type' => 'task',
                'state' => 'todo',
                'p' => 'low',
                'a' => 'kira',
                'l' => ['backend'],
                'created' => '10-26',
            ],
        ];
    }
}
