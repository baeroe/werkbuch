<?php

use App\Enums\Locale;
use App\Models\Comment;
use App\Models\Label;
use App\Models\Notification;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\RichText\Document;
use Database\Seeders\Demo\Texts\DemoTexts;
use Database\Seeders\Demo\Texts\English;
use Database\Seeders\Demo\Texts\German;
use Database\Seeders\Demo\WebhooksSeeder;
use Database\Seeders\DemoSeeder;
use Database\Seeders\DemoSeederEn;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Support\SharedDemoTexts;

// the language is static: a test that fails midway must not leave English to the next one
afterEach(fn () => DemoTexts::use(Locale::De));

beforeEach(function () {
    // the demo files land on the disk `local`; the seeders end with a rebuilt search index; the schedules count from
    // the moment of seeding, so both languages seed at the same one
    Storage::fake('local');
    searchEngine();
    $this->travelTo('2026-11-05 09:00:00');
});

$germanIn = SharedDemoTexts::germanIn(...);

/** The keys of the texts of the wiki, the templates and the webhooks. */
$contentKeys = fn (): array => array_values(array_filter(array_keys(German::TEXTS), fn (string $key) => preg_match('/^(page|template|webhook)\./', $key) === 1));

/**
 * A page's place: its project and the ranks from the top of the wiki down to it (`WEB/a0/a1`).
 */
$place = function (Page $page): string {
    $ranks = [];
    for ($at = $page; $at !== null; $at = $at->parent_id === null ? null : Page::query()->find($at->parent_id)) {
        array_unshift($ranks, $at->rank);
    }

    return Project::query()->whereKey($page->project_id)->value('identifier').'/'.implode('/', $ranks);
};

/**
 * Every id the seeded demo knows, replaced by what it names in either language.
 *
 * @return array<string, string>
 */
$tokens = function () use ($place): array {
    $workflows = Workflow::query()->orderBy('id')->with('states')->get()->values();
    $comments = Comment::query()->with('workItem.project')->orderBy('created_at')->orderBy('id')->get()
        ->groupBy(fn (Comment $comment) => $comment->workItem->key)
        ->flatMap(fn ($group, string $key) => $group->values()->mapWithKeys(fn (Comment $comment, int $n) => [$comment->id => "comment:{$key}:".($n + 1)]));

    return [
        ...User::query()->pluck('handle', 'id')->map(fn (string $handle) => "user:{$handle}")->all(),
        ...Project::query()->pluck('identifier', 'id')->map(fn (string $identifier) => "project:{$identifier}")->all(),
        ...WorkItem::query()->with('project')->get()->mapWithKeys(fn (WorkItem $item) => [$item->id => "item:{$item->key}"])->all(),
        ...WorkItemType::query()->orderBy('id')->pluck('id')->flip()->map(fn (int $n) => "type:{$n}")->all(),
        ...Label::query()->orderBy('id')->pluck('id')->flip()->map(fn (int $n) => "label:{$n}")->all(),
        ...$workflows->flatMap(fn (Workflow $workflow, int $n) => $workflow->states->mapWithKeys(fn ($state) => [$state->id => "state:{$n}:{$state->position}"]))->all(),
        ...$comments->all(),
        ...Page::query()->get()->mapWithKeys(fn (Page $page) => [$page->id => 'page:'.$place($page)])->all(),
        ...Template::query()->with('project')->get()->mapWithKeys(fn (Template $template) => [$template->id => "template:{$template->project->identifier}"])->all(),
        ...Webhook::query()->orderBy('created_at')->pluck('id')->flip()->map(fn (int $n) => "webhook:{$n}")->all(),
    ];
};

/** The shape of a stored text without its words: its blocks, their sizes and the nodes it names. */
$shape = function (?array $doc) use (&$shape): ?array {
    return $doc === null ? null : array_map(fn (array $node) => match ($node['type']) {
        'text' => 'text',
        'reference', 'mention' => "{$node['type']}:{$node['attrs']['id']}",
        default => [$node['type'], $node['attrs'] ?? null, $shape($node)],
    }, $doc['content'] ?? []);
};

/** Replaces every id in a fingerprint by its token. */
$wordless = fn (array $fingerprint, array $tokens): array => json_decode(strtr((string) json_encode($fingerprint), $tokens), true);

/**
 * Seeds the German demo in a transaction that is rolled back, then the English one: the fingerprint of each.
 *
 * @return array{0: array<string, mixed>, 1: array<string, mixed>}
 */
$both = function (object $test, Closure $fingerprint) use ($tokens, $wordless): array {
    DB::beginTransaction();
    $test->seed(DemoSeeder::class);
    $german = $wordless($fingerprint(), $tokens());
    DB::rollBack();
    // the organization and the roles of the German run are gone with it
    app()->forgetScopedInstances();

    $test->seed(DemoSeederEn::class);

    return [$german, $wordless($fingerprint(), $tokens())];
};

$stamp = fn (?DateTimeInterface $time) => $time?->format(DATE_ATOM);

it('seeds the same wiki tree in English', function () use ($both, $place, $shape, $stamp) {
    $fingerprint = fn (): array => [
        'pages' => Page::query()->get()->map(fn (Page $page) => [
            $place($page), $page->parent_id, $page->emoji, $page->version, $page->created_by, $page->updated_by,
            $stamp($page->created_at), $stamp($page->updated_at), $shape($page->content), $page->content_text === null,
        ])->sortBy(fn (array $row) => $row[0])->values()->all(),
        'versions' => PageVersion::query()->get()->map(fn (PageVersion $version) => [
            $version->page_id, $version->version, $version->author_id, $stamp($version->created_at), $shape($version->content),
        ])->sortBy(fn (array $row) => $row[0].$row[1])->values()->all(),
        'references' => DB::table('page_item_references')->get(['page_id', 'work_item_id'])->map(fn (object $row) => [$row->page_id, $row->work_item_id])
            ->sortBy(fn (array $row) => $row[0].$row[1])->values()->all(),
    ];

    [$german, $english] = $both($this, $fingerprint);

    expect($english)->toBe($german)
        // the probe: every page and version by its place, the references by the item they name
        ->and($german['pages'])->toHaveCount(19)
        ->and($german['versions'])->toHaveCount(3)
        ->and($german['references'])->toHaveCount(8)
        ->and(json_encode($german, JSON_UNESCAPED_SLASHES))->toContain('page:WEB/a0/a0', 'page:APP/a2/a0', 'reference:item:WEB-47', 'user:ida');

    // the English titles, and the version numbered like the page is its title and text (T4-M1)
    $titles = collect(English::TEXTS)->filter(fn (string $text, string $key) => preg_match('/^page\.\w+\.title$/', $key) === 1)->sort()->values()->all();
    $structure = Page::query()->where('title', English::TEXTS['page.web_structure.title'])->sole();
    $current = $structure->versions()->where('version', $structure->version)->sole();

    expect(Page::query()->pluck('title')->sort()->values()->all())->toBe($titles)
        ->and($titles)->toHaveCount(19)
        ->and([$current->title, $current->content])->toBe([$structure->title, $structure->content])
        ->and($structure->versions()->where('version', '<', $structure->version)->pluck('title')->unique()->all())->toBe([$structure->title])
        ->and($structure->content_text)->toContain('Studio Northlight');
});

it('seeds the same templates with their runs', function () use ($both, $shape, $stamp) {
    $fingerprint = fn (): array => [
        'templates' => Template::query()->with('project')->get()->map(fn (Template $template) => [
            $template->project->identifier, $template->schedule, $template->run_count, $stamp($template->last_run_at),
            $stamp($template->next_run_at), $stamp($template->schedule_from), $template->created_by, $stamp($template->created_at),
            [...array_diff_key($template->payload, ['title' => true, 'description' => true]), 'description' => $shape($template->payload['description'])],
            // the placeholders of the title, in order
            preg_match_all('/\{\w+\}/', $template->payload['title'], $placeholders) ? $placeholders[0] : [],
        ])->sortBy(fn (array $row) => $row[0])->values()->all(),
        'runs' => TemplateRun::query()->get()->map(fn (TemplateRun $run) => [
            $run->template_id, $stamp($run->scheduled_for), $stamp($run->ran_at), $run->status, $run->work_item_id, $run->error === null,
        ])->sortBy(fn (array $row) => $row[1])->values()->all(),
        'items' => WorkItem::query()->whereNotNull('template_id')->get()->map(fn (WorkItem $item) => [$item->id, $item->template_id, $stamp($item->updated_at)])
            ->sortBy(fn (array $row) => $row[0])->values()->all(),
    ];

    [$german, $english] = $both($this, $fingerprint);
    DemoTexts::use(Locale::En);
    $failed = TemplateRun::query()->where('status', TemplateRun::FAILED)->sole();

    expect($english)->toBe($german)
        ->and($german['templates'])->toHaveCount(3)
        ->and($german['runs'])->toHaveCount(7)
        ->and($german['items'])->toHaveCount(6)
        ->and(json_encode($german))->toContain('item:WEB-52', 'template:OPS', '{week}', '{month_name}', 'label:', 'user:jonas')
        // the English names and titles, the placeholders kept as they are
        ->and(Template::query()->orderBy('name')->get()->map(fn (Template $template) => [$template->name, $template->payload['title']])->all())->toBe([
            [English::TEXTS['template.ops_certs.name'], English::TEXTS['template.ops_certs.title']],
            [English::TEXTS['template.app_report.name'], English::TEXTS['template.app_report.title']],
            [English::TEXTS['template.web_maintenance.name'], English::TEXTS['template.web_maintenance.title']],
        ])
        ->and(Document::fromJson((array) Template::query()->where('name', English::TEXTS['template.web_maintenance.name'])->sole()->payload['description'])->toText())
        ->toBe(English::TEXTS['template.web_maintenance.description'])
        // the failed run says what the app says in English
        ->and($failed->error)->toBe(__('templates.run.required_missing.one', ['properties' => English::TEXTS['catalog.property.environment.label']], 'en'))
        ->and($failed->error)->toBe('Required property Environment is missing');
});

it('seeds the same inbox of Mara', function () use ($both, $stamp) {
    $fingerprint = fn (): array => Notification::query()->orderBy('dedupe_key')->get()->map(fn (Notification $notification) => [
        $notification->user_id, $notification->dedupe_key, $notification->kind->value, $notification->project_id, $notification->work_item_id,
        $notification->actor_id, $notification->inbox, $stamp($notification->read_at), $stamp($notification->created_at),
        // the texts the inbox stores: a state's and a webhook's name, a run's error
        array_diff_key($notification->data, ['name' => true, 'error' => true, 'from' => true, 'to' => true]),
        isset($notification->data['from']) ? [$notification->data['from']['id'], $notification->data['to']['id']] : null,
    ])->all();

    [$german, $english] = $both($this, $fingerprint);
    $data = Notification::query()->pluck('data', 'dedupe_key');

    expect($english)->toBe($german)
        ->and($german)->toHaveCount(14)
        ->and(collect($german)->whereNull(7)->count())->toBe(3)
        ->and(collect($german)->pluck(2)->unique()->sort()->values()->all())
        ->toBe(['assigned', 'comment', 'due', 'item_changed', 'mentioned', 'state_changed', 'template_run_failed', 'webhook_disabled'])
        ->and(json_encode($german))->toContain('comment:WEB-42:1', 'template:OPS', 'webhook:0', 'state:')
        // the texts in English: the webhook's name, the run's error, the states of the workflow
        ->and($data['seed:n_10']['name'])->toBe('Legacy CRM')
        ->and($data['seed:n_14']['error'])->toBe('Required property Environment is missing')
        ->and([$data['seed:n_05']['from']['name'], $data['seed:n_05']['to']['name']])->toBe(['In Progress', 'Done']);
});

it('seeds the same webhooks and attempts', function () use ($both, $stamp) {
    $fingerprint = fn (): array => [
        'webhooks' => Webhook::query()->orderBy('created_at')->get()->map(fn (Webhook $webhook) => [
            $webhook->id, (string) preg_replace('#^https://[^/]+#', '', $webhook->url), $webhook->project_id, $webhook->events, $webhook->bot_id,
            $webhook->active, $stamp($webhook->disabled_at), $stamp($webhook->failing_since), $stamp($webhook->last_success_at),
            $webhook->created_by, $stamp($webhook->created_at),
        ])->all(),
        'deliveries' => WebhookDelivery::query()->orderBy('created_at')->get()->map(fn (WebhookDelivery $delivery) => [
            $delivery->webhook_id, $delivery->event, $delivery->body, $delivery->status, $delivery->attempts, $stamp($delivery->created_at), $stamp($delivery->updated_at),
        ])->all(),
        'attempts' => WebhookAttempt::query()->orderBy('attempted_at')->get()->map(fn (WebhookAttempt $attempt) => [
            $attempt->webhook_id, $attempt->attempt, $attempt->kind, $attempt->status_code, $attempt->duration_ms, $attempt->response_excerpt,
            $attempt->error === null, $stamp($attempt->attempted_at),
        ])->all(),
    ];

    [$german, $english] = $both($this, $fingerprint);

    expect($english)->toBe($german)
        ->and($german['webhooks'])->toHaveCount(3)
        ->and($german['deliveries'])->toHaveCount(10)
        ->and($german['attempts'])->toHaveCount(18)
        ->and(json_encode($german))->toContain('webhook:0', 'project:APP', 'user:kira', 'bot.*')
        // the English names and hosts; the CRM is the client's, outside the organization
        ->and(Webhook::query()->orderBy('created_at')->get()->map(fn (Webhook $webhook) => [$webhook->name, $webhook->url])->all())->toBe([
            ['Legacy CRM', 'https://crm.example.com/api/inbound/werkbuch'],
            ['Deploy bot', 'https://deploy.fieldwork.example.com/hooks/werkbuch'],
            ['Kira', 'https://kira.fieldwork.example.com/werkbuch/webhook'],
        ])
        ->and(WebhookAttempt::query()->whereNotNull('error')->pluck('error')->unique()->values()->all())->toBe([WebhooksSeeder::TIMEOUT_ERROR]);
});

it('writes no German into the wiki, templates and webhooks', function () use ($germanIn, $contentKeys) {
    $this->seed(DemoSeederEn::class);
    $text = fn (mixed $doc): string => is_array($doc) ? Document::fromJson($doc)->toText() : '';
    $written = collect([
        ...Page::query()->pluck('title')->all(),
        ...Page::query()->pluck('content_text')->all(),
        ...PageVersion::query()->get()->flatMap(fn (PageVersion $version) => [$version->title, $text($version->content)])->all(),
        ...Template::query()->get()->flatMap(fn (Template $template) => [$template->name, $template->payload['title'], $text($template->payload['description'])])->all(),
        ...TemplateRun::query()->pluck('error')->all(),
        ...Webhook::query()->get()->flatMap(fn (Webhook $webhook) => [$webhook->name, $webhook->url])->all(),
        ...WebhookAttempt::query()->pluck('error')->all(),
        ...Notification::query()->pluck('data')->map(fn (array $data) => (string) json_encode($data, JSON_UNESCAPED_UNICODE))->all(),
    ])->filter(fn (mixed $text) => is_string($text) && $text !== '');
    $german = collect(SharedDemoTexts::germanOnly())->filter(fn (string $text) => mb_strlen($text) > 3);

    expect($written->map($germanIn)->filter()->values()->all())->toBe([])
        ->and($written->filter(fn (string $text) => $german->contains(fn (string $word) => str_contains($text, $word)))->values()->all())->toBe([])
        // key by key, no English text equals its German one without a reason
        ->and(array_values(array_filter($contentKeys(), fn (string $key) => German::TEXTS[$key] === English::TEXTS[$key] && ! isset(SharedDemoTexts::KEYS[$key]))))->toBe([])
        ->and(count($contentKeys()))->toBeGreaterThan(40)
        // the probe: the rows read hold the texts of the seeders, and the German ones would show
        ->and($written->count())->toBeGreaterThan(60)
        ->and($written->contains(English::TEXTS['page.web_handbook.title']))->toBeTrue()
        ->and($germanIn(German::TEXTS['page.web_contactform.content']))->not->toBeNull()
        // no host of the German organization
        ->and($written->filter(fn (string $text) => str_contains($text, 'feldwerk'))->values()->all())->toBe([]);
});
