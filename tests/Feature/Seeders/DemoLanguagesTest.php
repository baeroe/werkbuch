<?php

use App\Enums\Locale;
use App\Models\Automation;
use App\Models\Comment;
use App\Models\Favorite;
use App\Models\Notification;
use App\Models\Page;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\View;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use Database\Seeders\Demo\Texts\DemoTexts;
use Database\Seeders\Demo\Texts\English;
use Database\Seeders\Demo\Texts\German;
use Database\Seeders\DemoSeeder;
use Database\Seeders\DemoSeederEn;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\Support\SharedDemoTexts;

// The whole demo in both languages (A443): the English one has the shape of the German one, row by row, read over
// handles, identifiers, keys and the keys of the demo texts, never over a text or a ULID.

// the language is static: a test that fails midway must not leave English to the next one
afterEach(fn () => DemoTexts::use(Locale::De));

beforeEach(function () {
    // the demo files land on the disk `local`; the seeders end with a rebuilt search index; the schedules count from
    // the moment of seeding, so both languages seed at the same one
    Storage::fake('local');
    $this->engine = searchEngine();
    $this->travelTo('2026-11-05 09:00:00');
});

/**
 * Runs the German demo in a transaction that is rolled back, then the English one, and reads each with $read (given
 * the texts of the language it reads).
 *
 * @return array{0: mixed, 1: mixed}
 */
$inEach = function (object $test, Closure $read): array {
    DB::beginTransaction();
    $test->seed(DemoSeeder::class);
    $german = $read(German::TEXTS);
    DB::rollBack();
    // the organization and the roles of the German run are gone with it
    app()->forgetScopedInstances();
    // and so is its index: the English run starts from an empty one, as on a database of its own
    $test->engine = searchEngine();

    $test->seed(DemoSeederEn::class);

    return [$german, $read(English::TEXTS)];
};

/**
 * The key of a demo text by the text: `catalog.label.<key>` for the label „Formulare“ or „Forms“. A text no key of
 * the demo holds stays itself, prefixed, so the two languages differ there.
 *
 * @param  array<string, string>  $texts
 */
$keyOf = function (array $texts, string $pattern, ?string $text): ?string {
    if ($text === null) {
        return null;
    }
    $keys = array_values(array_filter(
        array_keys($texts, $text, true),
        fn (string $key) => preg_match($pattern, $key) === 1,
    ));

    return count($keys) === 1 ? (string) preg_replace($pattern, '$1', $keys[0]) : "unknown:{$text}";
};

/**
 * The tables of the test database (never those of another schema the account sees, such as `load`).
 *
 * @return list<string>
 */
$tables = fn (): array => collect(Schema::getTables(DB::getDatabaseName()))->pluck('name')->sort()->values()->all();

it('seeds the English demo in the shape of the German one', function () use ($inEach, $keyOf, $tables) {
    $fingerprint = function (array $texts) use ($keyOf, $tables): array {
        $handles = User::query()->pluck('handle', 'id');
        $keys = WorkItem::query()->with('project')->get()->mapWithKeys(fn (WorkItem $item) => [$item->id => $item->key]);
        $states = WorkflowState::query()->get()->mapWithKeys(fn (WorkflowState $state) => [$state->id => "{$state->category->value}:{$state->position}"]);
        $identifiers = Project::query()->pluck('identifier', 'id');
        $page = fn (Page $page): ?string => $keyOf($texts, '/^page\.(\w+)\.title$/', $page->title);
        $tree = function (?string $parent, Collection $pages) use (&$tree, $page): array {
            return $pages->where('parent_id', $parent)->sortBy('rank', SORT_STRING)->values()
                ->mapWithKeys(fn (Page $child) => [$page($child) => $tree($child->id, $pages)])->all();
        };
        $template = fn (Template $template): ?string => $keyOf($texts, '/^template\.(\w+)\.name$/', $template->name);
        $webhook = fn (?Webhook $webhook): ?string => $keyOf($texts, '/^webhook\.(\w+)\.name$/', $webhook?->name);
        $view = fn (?string $name): ?string => $keyOf($texts, '/^view\.(\w+)\.name$/', $name);
        $engine = $this->engine;

        return [
            'rows' => collect($tables())->mapWithKeys(fn (string $table) => [$table => DB::table($table)->count()])->all(),
            'items' => WorkItem::query()->with(['type', 'state', 'labels', 'parent.project', 'project'])->get()
                ->sortBy(fn (WorkItem $item) => $item->key, SORT_NATURAL)
                ->mapWithKeys(fn (WorkItem $item) => [$item->key => [
                    $keyOf($texts, '/^catalog\.type\.(\w+)\.name$/', $item->type->name),
                    $item->state->category->value,
                    $handles[$item->assignee_id] ?? null,
                    $item->due_date?->format('Y-m-d'),
                    $item->parent?->key,
                    $item->labels->map(fn ($label) => $keyOf($texts, '/^catalog\.label\.(\w+)$/', $label->name))->sort()->values()->all(),
                ]])->all(),
            'relations' => WorkItemRelation::query()->with('type')->get()
                ->map(fn (WorkItemRelation $relation) => [
                    $keys[$relation->source_id], $keys[$relation->target_id],
                    $relation->type->built_in ?? $keyOf($texts, '/^catalog\.relation\.(\w+)\.name$/', $relation->type->name),
                ])->sortBy(fn (array $row) => implode(' ', $row), SORT_NATURAL)->values()->all(),
            'comments' => Comment::query()->get()->countBy(fn (Comment $comment) => $keys[$comment->work_item_id])->sortKeys(SORT_NATURAL)->all(),
            'pages' => Page::query()->get()->groupBy(fn (Page $page) => $identifiers[$page->project_id])->sortKeys()
                ->map(fn (Collection $pages) => $tree(null, $pages))->all(),
            'templates' => Template::query()->get()->map(fn (Template $row) => [
                $identifiers[$row->project_id], $template($row), $row->schedule, $row->run_count, $handles[$row->created_by],
            ])->sortBy(fn (array $row) => $row[1])->values()->all(),
            'runs' => TemplateRun::query()->with('template')->get()->map(fn (TemplateRun $run) => [
                $template($run->template), $run->scheduled_for?->format(DATE_ATOM), $run->status,
                $keys[$run->work_item_id] ?? null, $handles[$run->triggered_by] ?? null,
            ])->sortBy(fn (array $row) => implode(' ', array_map('strval', $row)))->values()->all(),
            'views' => View::query()->get()->map(fn (View $row) => [$view($row->name), $row->icon, $handles[$row->created_by], $row->display['layout']])
                ->sortBy(fn (array $row) => $row[0])->values()->all(),
            'favorites' => Favorite::query()->get()->map(fn (Favorite $favorite) => [
                $handles[$favorite->user_id], $favorite->favoritable_type,
                $favorite->favoritable_type === 'project'
                    ? $identifiers[$favorite->favoritable_id]
                    : $view(View::query()->whereKey($favorite->favoritable_id)->value('name')),
                $favorite->position,
            ])->sortBy(fn (array $row) => "{$row[0]} {$row[3]}")->values()->all(),
            'inbox' => Notification::query()->orderBy('dedupe_key')->get()->map(fn (Notification $notification) => [
                $handles[$notification->user_id], $notification->dedupe_key, $notification->kind->value, $notification->inbox,
                $notification->read_at === null,
            ])->all(),
            'webhooks' => Webhook::query()->orderBy('created_at')->get()->map(fn (Webhook $row) => [
                $webhook($row), $identifiers[$row->project_id] ?? null, $row->events, $handles[$row->bot_id] ?? null, $row->active,
                $row->disabled_at !== null,
            ])->all(),
            'attempts' => WebhookAttempt::query()->orderBy('attempted_at')->get()->map(fn (WebhookAttempt $attempt) => [
                $webhook(Webhook::query()->find($attempt->webhook_id)), $attempt->attempt, $attempt->kind, $attempt->status_code,
                $attempt->error === null,
            ])->all(),
            'automations' => Automation::query()->get()->map(fn (Automation $automation) => [
                $identifiers[$automation->project_id], $automation->key->value, $automation->enabled,
                [...$automation->settings, ...(isset($automation->settings['state_id']) ? ['state_id' => $states[$automation->settings['state_id']]] : [])],
            ])->sortBy(fn (array $row) => "{$row[0]} {$row[1]}")->values()->all(),
            'search' => collect([WorkItem::class, Page::class, Project::class, User::class])->mapWithKeys(fn (string $model) => [
                (new $model)->getTable() => count($engine->documents((new $model)->searchableAs())),
            ])->all(),
        ];
    };

    [$german, $english] = $inEach($this, $fingerprint);
    $json = json_encode($german, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    expect($english)->toBe($german)
        // the probe: every part holds the demo, read over its keys, never over a text of one language
        ->and($german['rows']['work_items'])->toBe(71)
        ->and($german['rows']['events'])->toBeGreaterThan(40)
        ->and($german['items'])->toHaveCount(71)
        ->and($german['items']['WEB-47'][0])->toBe('bug')
        ->and($german['relations'])->toHaveCount(8)
        ->and(array_sum($german['comments']))->toBe(17)
        ->and($german['pages']['WEB'])->toHaveKey('web_handbook')
        ->and($german['templates'])->toHaveCount(3)
        ->and($german['runs'])->toHaveCount(7)
        ->and($german['views'])->toHaveCount(6)
        ->and($german['favorites'])->not->toBeEmpty()
        ->and($german['inbox'])->toHaveCount(14)
        ->and($german['webhooks'])->toHaveCount(3)
        ->and($german['attempts'])->toHaveCount(18)
        ->and($german['automations'])->not->toBeEmpty()
        ->and($german['search']['work_items'] ?? null)->toBe(71)
        ->and($json)->not->toContain('unknown:');
});

it('keeps every mail at example.com', function () use ($inEach, $tables) {
    // every row of every table, the addresses in it: accounts, invitations, and any address a text or a payload names
    $mails = function () use ($tables): array {
        $found = [];
        foreach ($tables() as $table) {
            $text = (string) json_encode(DB::table($table)->get(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            preg_match_all('/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/', $text, $matches);
            $found = [...$found, ...$matches[0]];
        }

        return array_values(array_unique($found));
    };

    [$german, $english] = $inEach($this, fn () => $mails());
    $foreign = fn (array $mails) => array_values(array_filter($mails, fn (string $mail) => ! str_ends_with(strtolower($mail), '.example.com') && ! str_ends_with(strtolower($mail), '@example.com')));

    expect($foreign($german))->toBe([])
        ->and($foreign($english))->toBe([])
        // the probe: the people of each team, the domain of its language
        ->and($german)->toContain('mara@feldwerk.example.com')
        ->and($english)->toContain('mara@fieldwork.example.com')
        ->and(array_filter($english, fn (string $mail) => str_contains($mail, 'feldwerk')))->toBe([]);
});

it('rebuilds the search index in English', function () {
    $this->seed(DemoSeederEn::class);
    $documents = fn (string $model): array => $this->engine->documents((new $model)->searchableAs());
    $items = collect($documents(WorkItem::class));
    $titles = collect(English::TEXTS)->filter(fn (string $text, string $key) => preg_match('/^item\.[A-Z]+-\d+\.title$/', $key) === 1);

    expect($items)->toHaveCount(WorkItem::query()->count())
        ->and($items)->toHaveCount(71)
        ->and($documents(Page::class))->toHaveCount(Page::query()->count())
        ->and($documents(Project::class))->toHaveCount(Project::query()->count())
        ->and($documents(User::class))->toHaveCount(User::query()->count())
        // the titles in the index are the English ones, not a German one among them
        ->and($items->pluck('title')->sort()->values()->all())->toBe($titles->sort()->values()->all())
        ->and($items->pluck('title')->map(SharedDemoTexts::germanIn(...))->filter()->values()->all())->toBe([])
        ->and(collect($documents(Page::class))->pluck('title')->all())->toContain(English::TEXTS['page.web_handbook.title'])
        ->and(collect($documents(Project::class))->pluck('name')->all())->toContain(English::TEXTS['project.WEB.name']);
});
