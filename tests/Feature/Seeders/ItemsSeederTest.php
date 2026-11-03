<?php

use App\Actions\Projects\AssignWorkflow;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\ListHistory;
use App\Http\Resources\HistoryEntryResource;
use App\Models\Event;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemSubscriber;
use App\RichText\Document;
use Database\Seeders\Demo\ActivitySeeder;
use Database\Seeders\Demo\ItemsSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

// the demo files of the AttachmentsSeeder land on the disk `local`
beforeEach(fn () => Storage::fake('local'));

/**
 * The seed of the clickdummy (src/api/seed/{items,activity}.ts) as the seeders have to reproduce it: parsed from the
 * file, so a row that was copied wrong, a missed row or a changed seed shows here. Rows: key, type, title, state and
 * the optional priority, assignee, due date, parent and creator, as the file writes them.
 *
 * @return array{rows: array<string, array<string, ?string>>, relations: list<array{0: string, 1: string, 2: string}>, events: list<array{0: string, 1: string}>}
 */
$clickdummy = function (): array {
    $source = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/items.ts'));
    $start = (int) strpos($source, 'const rows: Row[] = [');
    $block = substr($source, $start, (int) strpos($source, "\n];\n", $start) - $start);
    $rows = [];

    foreach (array_slice(preg_split("/(?=\bkey: '[A-Z]+-\d+')/", $block) ?: [], 1) as $chunk) {
        $field = function (string $pattern) use ($chunk): ?string {
            preg_match($pattern, $chunk, $match);

            return isset($match[1]) ? stripcslashes($match[1]) : null;
        };
        $key = (string) $field("/key: '([A-Z]+-\d+)'/");
        $rows[$key] = [
            'type' => $field("/\btype: '(\w+)'/"),
            'title' => $field("/\btitle: '((?:[^'\\\\]|\\\\.)*)'/"),
            'state' => $field("/\bstate: '(\w+)'/"),
            'p' => $field("/[\s{,]p: '(\w+)'/"),
            'a' => $field("/[\s{,]a: '(\w+)'/"),
            'due' => $field("/\bdue: '([\d-]+)'/"),
            'parent' => $field("/\bparent: '([A-Z]+-\d+)'/"),
            'by' => $field("/[\s{,]by: '(\w+)'/"),
        ];
    }

    preg_match_all("/relation\('rel_\d+', 'rt_(\w+)', '([A-Z]+-\d+)', '([A-Z]+-\d+)'\)/", $source, $relations, PREG_SET_ORDER);
    $activity = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/activity.ts'));
    preg_match_all("/^\s+event\('ev_\w+', '(work_item\.\w+)', '([A-Z]+-\d+)'/m", $activity, $events, PREG_SET_ORDER);

    return [
        'rows' => $rows,
        'relations' => array_map(fn (array $match) => [$match[1], $match[2], $match[3]], $relations),
        'events' => array_map(fn (array $match) => [$match[2], $match[1]], $events),
    ];
};

/** The item of a key of the seeded demo. */
$item = fn (string $key): WorkItem => ItemsSeeder::find($key) ?? throw new RuntimeException("No item {$key}.");

/** What a whole run of the seeders leaves behind: counts and the columns a rerun must not move. */
$snapshot = fn (): array => [
    WorkItem::count(), Event::count(), WorkItemRelation::count(), WorkItemSubscriber::count(),
    DB::table('work_item_values')->count(), DB::table('work_item_labels')->count(),
    DB::table('work_items')->orderBy('id')->get(['id', 'rank', 'state_id', 'title', 'updated_at'])->all(),
    Event::query()->orderBy('id')->pluck('id')->all(),
    Project::query()->orderBy('identifier')->pluck('next_number', 'identifier')->all(),
];

$states = ['backlog' => 'Backlog', 'todo' => 'Todo', 'progress' => 'In Progress', 'review' => 'Review', 'approval' => 'Kundenfreigabe', 'pending' => 'Pending', 'done' => 'Done', 'cancelled' => 'Cancelled'];
$types = ['task' => 'Task', 'bug' => 'Bug', 'epic' => 'Epic', 'wish' => 'Kundenwunsch'];

it('seeds every row of the clickdummy', function () use ($clickdummy, $item, $states, $types) {
    $this->seed(DemoSeeder::class);
    $rows = $clickdummy()['rows'];
    $leads = ['WEB' => 'ida', 'APP' => 'theo', 'OPS' => 'jonas'];

    expect($rows)->toHaveCount(71)
        ->and(WorkItem::count())->toBe(count($rows))
        ->and(WorkItem::with('project')->get()->map->key->sort()->values()->all())->toBe(collect(array_keys($rows))->sort()->values()->all());

    foreach ($rows as $key => $row) {
        $seeded = $item($key)->load(['type', 'state', 'assignee', 'creator', 'parent.project']);

        expect([
            $seeded->type->name,
            $seeded->title,
            $seeded->state->name,
            $seeded->priority->value,
            $seeded->assignee?->handle,
            $seeded->due_date?->format('m-d'),
            $seeded->parent?->key,
            $seeded->creator->handle,
        ])->toBe([
            $types[$row['type']],
            $row['title'],
            $states[$row['state']],
            $row['p'] ?? 'none',
            $row['a'],
            $row['due'],
            $row['parent'],
            $row['by'] ?? $leads[explode('-', $key)[0]],
        ], $key);
    }
});

it('seeds WEB-47 like the moodboard', function () use ($item) {
    $this->seed(DemoSeeder::class);
    $web47 = $item('WEB-47');
    $values = $web47->values()->with('property.options')->get()->keyBy(fn ($row) => $row->property->key);

    expect([$web47->type->name, $web47->state->name, $web47->priority->value, $web47->assignee->handle])->toBe(['Bug', 'In Progress', 'urgent', 'jonas'])
        ->and($web47->labels->pluck('name')->all())->toBe(['Formulare', 'Produktion'])
        ->and([$web47->start_date->format('Y-m-d'), $web47->due_date->format('Y-m-d')])->toBe(['2026-10-27', '2026-10-31'])
        ->and($values['customer']->property->options->firstWhere('id', $values['customer']->value_option_id)->label)->toBe('Studio Nordlicht')
        ->and($values['environment']->property->options->firstWhere('id', $values['environment']->value_option_id)->label)->toBe('Produktion')
        ->and($values['effort']->value_number)->toBe(3.5)
        ->and($values['browser']->value_string)->toBe('Safari 18 (iOS)')
        ->and($values['steps']->value_json['content'][1]['type'])->toBe('orderedList')
        ->and($values['steps']->value_json['content'][1]['content'])->toHaveCount(3)
        // @mara a mention and WEB-42 a reference (CommentsSeederTest names their IDs); the plain text has no keys
        ->and($web47->description_text)->toBe('Beim Absenden über Safari kommen zwei Mails an. @mara kannst du prüfen, ob das mit zusammenhängt?')
        ->and(array_column($web47->description['content'][0]['content'], 'type'))->toBe(['text', 'mention', 'text', 'reference', 'text'])
        ->and($web47->description_version)->toBe(1);
});

it('gives WEB-47 the history of the moodboard, with the relations on top', function () use ($item) {
    $this->seed(DemoSeeder::class);
    $web47 = $item('WEB-47');
    $mara = User::where('handle', 'mara')->sole();
    $entries = array_map(
        fn (Event $event) => (new HistoryEntryResource($event))->resolve(),
        ListHistory::run(actor($mara), $web47, [])->page->items(),
    );
    $who = fn (string $handle) => User::where('handle', $handle)->sole()->id;
    $std = Workflow::default()->states->keyBy('name');

    expect(array_column($entries, 'type'))->toBe([
        'work_item.created', 'work_item.relation_added', 'work_item.relation_added', 'work_item.state_changed', 'work_item.assigned', 'work_item.updated',
    ])
        ->and($entries[0]['actor_id'])->toBe($who('ida'))
        ->and($entries[0]['changes'])->toBe(['title' => ['old' => null, 'new' => 'Kontaktformular sendet doppelt']])
        ->and($entries[3]['actor_id'])->toBe($who('jonas'))
        ->and($entries[3]['changes'])->toBe(['state_id' => ['old' => $std['Todo']->id, 'new' => $std['In Progress']->id]])
        ->and($entries[3]['states'])->toBe([
            'old' => ['id' => $std['Todo']->id, 'name' => 'Todo', 'category' => 'unstarted'],
            'new' => ['id' => $std['In Progress']->id, 'name' => 'In Progress', 'category' => 'started'],
        ])
        ->and([$entries[4]['actor_id'], $entries[4]['via'], $entries[4]['reason']])->toBe([User::defaultBot()->id, 'automation', 'assign_on_start'])
        ->and($entries[4]['changes'])->toBe(['assignee_id' => ['old' => null, 'new' => $who('jonas')]])
        ->and([$entries[5]['actor_id'], $entries[5]['via'], $entries[5]['reason']])->toBe([$who('ida'), 'ui', null])
        ->and($entries[5]['changes'])->toBe(['priority' => ['old' => 'high', 'new' => 'urgent']])
        // the assignment comes after the start, by two seconds
        ->and($entries[4]['occurred_at'] > $entries[3]['occurred_at'])->toBeTrue()
        // OPS-12 (mara) blocks WEB-47, a minute after the later of the two: WEB-47 reads it inward
        ->and($entries[1]['actor_id'])->toBe($who('mara'))
        ->and($entries[1]['occurred_at'])->toBe('2026-10-20T12:01:00.000000Z')
        ->and($entries[1]['changes']['relation']['new'])->toBe(['label' => 'wird blockiert von', 'item_id' => $item('OPS-12')->id, 'key' => 'OPS-12'])
        // stored in the shape of RelationSnapshot, from the end of WEB-47
        ->and(Event::query()->findOrFail($entries[1]['id'])->changes)->toBe(['relation' => ['old' => null, 'new' => [
            'relation_type_id' => RelationType::query()->where('built_in', 'blocks')->sole()->id,
            'direction' => 'inward',
            'label' => 'wird blockiert von',
            'item_id' => $item('OPS-12')->id,
        ]]])
        // the second relation: WEB-54 tests WEB-47, by the creator of WEB-54
        ->and([$entries[2]['actor_id'], $entries[2]['changes']['relation']['new']['label'], $entries[2]['changes']['relation']['new']['key']])->toBe([$who('ida'), 'wird getestet von', 'WEB-54'])
        // nobody consumes these events: they count as dispatched when they happened (P23)
        ->and(Event::query()->where('subject_id', $web47->id)->whereNull('dispatched_at')->exists())->toBeFalse()
        ->and(Event::query()->where('subject_id', $web47->id)->whereColumn('dispatched_at', '!=', 'occurred_at')->exists())->toBeFalse();
});

it('shows an outsider of the private OPS project the other end of its relation only as hidden', function () use ($item) {
    $this->seed(DemoSeeder::class);
    $ida = User::where('handle', 'ida')->sole();

    $entries = array_map(
        fn (Event $event) => (new HistoryEntryResource($event))->resolve(),
        ListHistory::run(actor($ida), $item('WEB-47'), [])->page->items(),
    );
    $blocked = $entries[1]['changes']['relation']['new'];

    expect($blocked)->toBe(['label' => 'wird blockiert von', 'hidden' => true]);
});

it('seeds the relations, also across projects', function () use ($clickdummy, $item) {
    $this->seed(DemoSeeder::class);
    $relations = $clickdummy()['relations'];
    $names = ['blocks' => ['built_in', 'blocks'], 'duplicates' => ['built_in', 'duplicates'], 'relates' => ['built_in', 'relates'], 'tests' => ['name', 'testet']];

    expect($relations)->toHaveCount(8)->and(WorkItemRelation::count())->toBe(8)
        ->and($relations)->toBe(ItemsSeeder::RELATIONS);

    foreach ($relations as [$type, $source, $target]) {
        [$column, $value] = $names[$type];

        expect(WorkItemRelation::query()->where('source_id', $item($source)->id)->where('target_id', $item($target)->id)
            ->whereHas('type', fn ($query) => $query->where($column, $value))->count())->toBe(1, "{$source} {$type} {$target}");
    }

    // the blocker of the demo crosses the projects: OPS-12 (private) holds up WEB-47
    expect($item('OPS-12')->project->identifier)->not->toBe($item('WEB-47')->project->identifier)
        ->and(WorkItem::query()->withComputed()->whereKey($item('WEB-47')->id)->sole()->is_blocked)->toBeTrue()
        ->and(WorkItem::query()->withComputed()->whereKey($item('OPS-12')->id)->sole()->is_blocking)->toBeTrue();
});

it('keeps two levels: every child has an epic as its parent, no epic has one', function () {
    $this->seed(DemoSeeder::class);

    $children = WorkItem::query()->whereNotNull('parent_id')->with(['parent.type', 'project'])->get();

    expect($children->count())->toBeGreaterThan(20)
        ->and($children->every(fn (WorkItem $child) => $child->parent->type->is_epic && $child->parent->project_id === $child->project_id))->toBeTrue()
        ->and(WorkItem::query()->whereHas('type', fn ($query) => $query->where('is_epic', true))->whereNotNull('parent_id')->exists())->toBeFalse();
});

it('derives the times from the rows, in Berlin time', function () use ($item) {
    $this->seed(DemoSeeder::class);
    $utc = fn (?DateTimeInterface $time) => $time?->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i');

    // WEB-39: started and closed with their own times (CEST, two hours ahead of UTC on 19 October)
    expect($utc($item('WEB-39')->started_at))->toBe('2026-10-19 08:00')
        // (the clocks went back on 25 October: CET, one hour ahead)
        ->and($utc($item('WEB-39')->closed_at))->toBe('2026-10-27 15:20')
        ->and($item('WEB-39')->resolution->label)->toBe('Done')
        // WEB-52 started at 09:00 (the row names no minute for a day, 09:00 and 10:00 are the defaults of the file)
        ->and($utc($item('WEB-52')->started_at))->toBe('2026-10-27 08:00')
        ->and($item('WEB-52')->closed_at)->toBeNull()
        // a closed row without a resolution: the default of its category; named ones keep theirs
        ->and($item('WEB-36')->resolution->label)->toBe("Won't do")
        ->and($item('APP-21')->resolution->label)->toBe('Duplicate')
        ->and($item('WEB-14')->resolution->label)->toBe('Cannot reproduce')
        // archived by the auto-archive
        ->and($utc($item('WEB-8')->archived_at))->toBe('2026-10-16 01:00')
        ->and($item('WEB-47')->archived_at)->toBeNull()
        ->and($item('WEB-47')->resolution_id)->toBeNull()
        // updated: the row's time, else the latest of created, started and closed
        ->and($utc($item('WEB-47')->updated_at))->toBe('2026-10-27 09:20')
        ->and($utc($item('WEB-39')->updated_at))->toBe('2026-10-27 15:20')
        // a created time without a clock gets one from the number: 09:(7·number mod 50 + 5)
        ->and($utc($item('WEB-3')->created_at))->toBe('2026-08-24 07:26');
});

it('stores the descriptions as the editor would, and the ranks in the order of the numbers', function () {
    $this->seed(DemoSeeder::class);

    foreach (WorkItem::query()->whereNotNull('description')->get() as $seeded) {
        expect(Document::fromJson($seeded->description)->toJson())->toBe($seeded->description)
            ->and(Document::fromJson($seeded->description)->toText())->toBe($seeded->description_text);
    }

    foreach (Project::query()->get() as $project) {
        $ranks = WorkItem::query()->where('project_id', $project->id)->orderBy('number')->pluck('rank')->all();
        $sorted = $ranks;
        usort($sorted, 'strcmp');

        expect($ranks)->toBe($sorted)->and(array_unique($ranks))->toHaveCount(count($ranks));
    }
});

it('counts on from the highest number, gaps included', function () {
    $this->seed(DemoSeeder::class);

    expect(Project::query()->orderBy('identifier')->pluck('next_number', 'identifier')->all())->toBe(['APP' => 24, 'OPS' => 15, 'WEB' => 56]);
});

it('lets the creator, the assignee and the people the description mentions watch, but no bot and nobody deactivated', function () use ($item) {
    $this->seed(DemoSeeder::class);
    $watchers = fn (string $key) => WorkItemSubscriber::query()->where('work_item_id', $item($key)->id)->with('user')->get()
        ->mapWithKeys(fn ($row) => [$row->user->handle => $row->reason])->all();

    expect($watchers('WEB-47'))->toEqual(['ida' => 'created', 'jonas' => 'assigned', 'mara' => 'mentioned'])
        ->and($watchers('APP-24'))->toEqual(['theo' => 'created', 'mara' => 'assigned'])
        // created by the bot: only the assignee; assigned to Sven (deactivated): only the creator
        ->and($watchers('WEB-34'))->toBe(['jonas' => 'assigned'])
        ->and($watchers('WEB-3'))->toBe(['jonas' => 'created'])
        ->and(WorkItemSubscriber::query()->whereIn('user_id', User::query()->where('type', 'bot')->orWhereNotNull('disabled_at')->select('id'))->count())->toBe(0);
});

it('writes the history of every item of the file and nothing else', function () use ($clickdummy) {
    $this->seed(DemoSeeder::class);
    $events = $clickdummy()['events'];
    $keys = WorkItem::query()->with('project')->get()->mapWithKeys(fn (WorkItem $seeded) => [$seeded->id => $seeded->key]);
    $stored = Event::query()->where('subject_type', 'work_item')->where('type', '!=', 'work_item.relation_added')->get()
        ->map(fn (Event $event) => [$keys[$event->subject_id], $event->type->value])->all();
    $key = fn (array $pair) => implode(' ', $pair);

    expect($events)->toHaveCount(24)
        ->and(array_map($key, $stored))->toEqualCanonicalizing(array_map($key, $events))
        // two relation events a relation, one at each end
        ->and(Event::query()->where('type', 'work_item.relation_added')->count())->toBe(16);
});

it('changes nothing when it runs twice', function () use ($snapshot) {
    $this->seed(DemoSeeder::class);
    $before = $snapshot();
    $this->travel(5)->minutes();

    $this->seed(DemoSeeder::class);

    expect($snapshot())->toEqual($before);
});

it('never touches an item that exists: a change survives, a project that switched its workflow keeps its items', function () use ($item) {
    $this->seed(DemoSeeder::class);
    $app = Project::query()->where('identifier', 'APP')->with('workflow.states')->sole();
    $standard = Workflow::default();
    $target = $standard->states()->pluck('id', 'name');
    $mapping = $app->workflow->states->mapWithKeys(fn ($state) => [$state->id => $target[match ($state->name) {
        'Review' => 'In Progress', 'Kundenfreigabe' => 'Pending', default => $state->name,
    }]])->all();
    AssignWorkflow::run(actor(User::where('handle', 'mara')->sole()), $app, ['workflow_id' => $standard->id, 'mapping' => $mapping]);
    $item('WEB-47')->update(['title' => 'Umbenannt', 'priority' => 'low']);
    $item('APP-15')->update(['rank' => 'zzz']);
    $states = WorkItem::query()->where('project_id', $app->id)->orderBy('number')->pluck('state_id', 'number')->all();
    $events = Event::count();

    $this->seed(DemoSeeder::class);

    $stateIds = $standard->states()->pluck('id')->all();
    expect(WorkItem::query()->where('project_id', $app->id)->orderBy('number')->pluck('state_id', 'number')->all())->toBe($states)
        ->and(array_diff(array_values($states), $stateIds))->toBe([])
        ->and($item('WEB-47')->title)->toBe('Umbenannt')
        ->and($item('WEB-47')->priority->value)->toBe('low')
        ->and($item('APP-15')->rank)->toBe('zzz')
        ->and(Event::count())->toBe($events);
});

it('adds only the items that are missing, with the rank of their place, and writes their history once', function () use ($item) {
    $this->seed(DemoSeeder::class);
    $rank = $item('WEB-30')->rank;
    $before = WorkItem::count();
    $id = $item('WEB-30')->id;
    $item('WEB-31')->update(['parent_id' => null]);
    $item('WEB-30')->delete();
    Event::query()->where('subject_id', $id)->delete();

    $this->seed(DemoSeeder::class);

    expect(WorkItem::count())->toBe($before)
        ->and($item('WEB-30')->rank)->toBe($rank)
        ->and($item('WEB-30')->id)->not->toBe($id)
        ->and(Event::query()->where('subject_id', $item('WEB-30')->id)->where('type', 'work_item.created')->count())->toBe(1)
        // the child was changed by hand and stays as it is
        ->and($item('WEB-31')->parent_id)->toBeNull();
});

it('never brings back an item somebody deleted, so its number is not given out again', function () use ($item) {
    $this->seed(DemoSeeder::class);
    $web30 = $item('WEB-30');
    DeleteWorkItem::run(actor(User::query()->where('handle', 'mara')->sole()), $web30);

    $this->seed(DemoSeeder::class);

    expect(WorkItem::query()->where('project_id', $web30->project_id)->where('number', 30)->exists())->toBeFalse();
});

it('leaves the history of an item that has events of its own', function () use ($item) {
    $this->seed(DemoSeeder::class);
    $web42 = $item('WEB-42');
    Event::query()->where('subject_id', $web42->id)->where('type', '!=', 'work_item.created')->delete();
    $count = Event::query()->where('subject_id', $web42->id)->count();

    $this->seed(ActivitySeeder::class);

    expect(Event::query()->where('subject_id', $web42->id)->count())->toBe($count);
});

it('seeds a second time without a list of watchers changing a person who unsubscribed', function () use ($item) {
    $this->seed(DemoSeeder::class);
    $row = WorkItemSubscriber::query()->where('work_item_id', $item('WEB-47')->id)->whereHas('user', fn ($query) => $query->where('handle', 'jonas'))->sole();
    $row->update(['unsubscribed_at' => now()]);

    $this->seed(DemoSeeder::class);

    expect($row->fresh()?->unsubscribed_at)->not->toBeNull();
});
