<?php

use App\Actions\Automations\RunDailyAutomations;
use App\Actions\Templates\RunDueTemplates;
use App\Actions\Templates\RunTemplate;
use App\Domain\Automations\AutomationKey;
use App\Domain\Workflow\StateCategory;
use App\Events\Outbox;
use App\Jobs\DeliverWebhook;
use App\Jobs\RunTemplateJob;
use App\Live\LiveConsumer;
use App\Models\Attachment;
use App\Models\Automation;
use App\Models\Event;
use App\Models\Notification;
use App\Models\Project;
use App\Models\Template;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use App\RichText\Document;
use App\Search\SearchConsumer;
use App\Support\Actor;
use App\Support\TemplateAttachments;
use App\Webhooks\WebhookConsumer;
use App\Webhooks\WebhookPayload;
use Database\Seeders\Load\LoadContent;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Spatie\MediaLibrary\Conversions\Jobs\PerformConversionsJob;
use Tests\Load\LoadWorld;
use Tests\Load\Support\Budget;

/*
 * The work behind the API against 50 000 items (plan, Task 13b; K11, R5): a bulk change with 50 webhooks and the
 * consumption of its events, the night of Auto-Close over the 20 projects, the scheduler with 50 due templates and a
 * template run that copies 20 pictures of 2 MB. Each runs once (Budget::once(): a second run would find the work done)
 * in the transaction of the test, which DatabaseTransactions rolls back and declares the base of the app's
 * transactions: an action commits into it, so its afterCommit work (DispatchEvent, the jobs of the consumers) runs
 * (K11). LoadTestCase runs LoadWorld::ensure() before that transaction begins. The search consumer writes into the
 * in-memory engine of the feature tests (searchEngine() of tests/Pest.php, a global function every suite has), never
 * into Meilisearch, which no rollback would undo;
 * SearchLoadTest measures Meilisearch. The queue is `sync`: DeliverWebhook is faked (no HTTP), the conversions of the
 * media library too (a preview is the work of the queue `media`, not of the run).
 */

/**
 * The rows of this file and their budgets in seconds (null: only measured). The bulk change runs 100 transactions, one
 * per item; the night is a job of the queue `bulk`; the scheduler enqueues within the budget of an answer (A187).
 */
const WORK_ROWS = [
    'bulk change of 100 items, 50 webhooks' => 3.0,
    'consumption of the bulk change' => null,
    'night: Auto-Close over L01–L20' => 600.0,
    'scheduler: queue 50 due templates' => 1.5,
    'template run: copy 20 pictures of 2 MB' => 10.0,
    'template run with 20 pictures of 2 MB' => 10.0,
];

/** The rows over their budget, by the task that takes them out (like OVER_BUDGET of ApiLoadTest). */
const WORK_OVER_BUDGET = [];

/** The items of the bulk change. */
const BULK_ITEMS = 100;

/** The size of the description of one of them, in bytes of Tiptap JSON. */
const BIG_DESCRIPTION = 200 * 1_024;

/** The pictures of the template run and the bytes of each (an uncompressed PNG). */
const PICTURES = 20;

const PICTURE_BYTES = 2 * 1_048_576;

/** The most memory PHP may hold during the night (memory_get_peak_usage(), from its start): it works item by item. */
const NIGHT_MEMORY = 256 * 1_048_576;

/** The most memory PHP may hold while a template run copies its pictures (memory_get_peak_usage(), from its start). */
const COPY_MEMORY = 256 * 1_048_576;

/** Asserts the duration of a row against its budget, unless WORK_OVER_BUDGET names it. */
$within = function (string $name): void {
    $row = Budget::row($name);
    if ($row['budget'] !== null && ! array_key_exists($name, WORK_OVER_BUDGET)) {
        expect($row['median'])->toBeLessThanOrEqual($row['budget'], sprintf('%s took %.0f ms', $name, $row['median'] * 1_000));
    }
};

/** A Tiptap document of plain paragraphs of at least `$bytes` bytes as compact JSON. */
$bigDocument = function (int $bytes): array {
    $sentence = 'Die Seite lädt das Formular für die Kontaktdaten nach und prüft jedes Feld, bevor sie es an den Server schickt. ';
    $content = [];
    $size = 0;
    for ($n = 1; $size < $bytes; $n++) {
        $text = "Absatz {$n}: ".str_repeat($sentence, 2);
        $content[] = ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $text]]];
        $size += strlen((string) json_encode(end($content), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) + 1;
    }

    return ['type' => 'doc', 'content' => $content];
};

uses(DatabaseTransactions::class);

it('changes 100 items with 50 active webhooks and consumes their events', function () use ($within, $bigDocument) {
    $admin = User::query()->where('handle', 'load-01')->sole();
    $project = Project::query()->where('identifier', 'L07')->sole();
    $bot = User::query()->join('project_members', 'project_members.user_id', '=', 'users.id')
        ->where('project_members.project_id', $project->id)->where('users.type', 'bot')->select('users.*')->sole();
    $items = WorkItem::query()->where('project_id', $project->id)->whereNull('archived_at')
        ->where('priority', '!=', 'urgent')
        ->where(fn ($query) => $query->whereNull('assignee_id')->orWhere('assignee_id', '!=', $bot->id))
        ->orderBy('number')->limit(BULK_ITEMS)->pluck('id')->all();
    expect($items)->toHaveCount(BULK_ITEMS);

    // one item carries a description of 200 KB: its events are the biggest bodies a webhook gets
    $document = Document::fromJson($bigDocument(BIG_DESCRIPTION));
    $json = (string) json_encode($document->toJson(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    expect(strlen($json))->toBeGreaterThanOrEqual(BIG_DESCRIPTION);
    DB::table('work_items')->where('id', $items[0])->update(['description' => $json, 'description_text' => $document->toText()]);

    // the 50 webhooks of the seed, switched on for every event of the bulk change (`bot.assigned` included)
    expect(Webhook::query()->update(['active' => true, 'disabled_at' => null, 'events' => json_encode(['work_item.*', 'bot.*'])]))
        ->toBe(LoadContent::WEBHOOKS);

    $engine = searchEngine();
    Queue::fake([DeliverWebhook::class]);
    $start = now();

    // the request with the consumers off, as in production (their jobs run in the queue, not in the request)
    $name = 'bulk change of 100 items, 50 webhooks';
    $answer = Budget::once($name, fn () => $this->actingAs($admin)->postJson('/api/v1/work-items/bulk', [
        'ids' => $items, 'patch' => ['assignee_id' => $bot->id, 'priority' => 'urgent'],
    ]), WORK_ROWS[$name]);
    expect($answer)->toBeInstanceOf(TestResponse::class);
    $answer->assertOk();
    expect($answer->json('updated'))->toHaveCount(BULK_ITEMS)
        ->and($answer->json('rejected'))->toBe([]);
    $within($name);

    $events = Event::query()->where('occurred_at', '>=', $start)->orderBy('occurred_at')->orderBy('id')->get(['id', 'type']);
    expect($events->countBy(fn (Event $event) => $event->type->value)->sortKeys()->all())->toBe([
        'bot.assigned' => BULK_ITEMS, 'work_item.assigned' => BULK_ITEMS, 'work_item.updated' => BULK_ITEMS,
    ]);

    // the consumption of every event: search (in memory), notifications, live (broadcaster `null`) and webhooks
    consumers(SearchConsumer::class, NotificationConsumer::class, LiveConsumer::class, WebhookConsumer::class);
    $name = 'consumption of the bulk change';
    Budget::once($name, function () use ($events): void {
        foreach ($events as $event) {
            app(Outbox::class)->dispatch($event->id);
        }
    }, WORK_ROWS[$name]);

    // the search consumer wrote the 100 items into memory, never into Meilisearch
    expect(array_keys($engine->documents('load_work_items')))->toEqualCanonicalizing($items);

    $ids = $events->modelKeys();
    $deliveries = DB::table('webhook_deliveries')->whereIn('event_id', $ids);
    expect($deliveries->count())->toBe(LoadContent::WEBHOOKS * count($ids))
        ->and(Queue::pushed(DeliverWebhook::class))->toHaveCount(LoadContent::WEBHOOKS * count($ids));
    $largest = (int) DB::table('webhook_deliveries')->whereIn('event_id', $ids)->max(DB::raw('length(body)'));
    expect($largest)->toBeGreaterThan(BIG_DESCRIPTION)
        ->and($largest)->toBeLessThanOrEqual(WebhookPayload::MAX_BYTES);

    // the lead of L07 watches every item of the project (A269): one notification per change and per assignment
    $notifications = Notification::query()->whereIn('event_id', $ids)
        ->join('users', 'users.id', '=', 'notifications.user_id')
        ->groupBy('users.handle')->selectRaw('users.handle, count(*) as notifications')
        ->pluck('notifications', 'handle')->map(fn ($count) => (int) $count)->all();
    expect($notifications)->toBe([(string) $project->lead()->value('handle') => 2 * BULK_ITEMS]);

    fwrite(STDERR, sprintf(
        "\n%s: %d events, %d deliveries, largest body %d bytes, notifications %s\n",
        $name, count($ids), LoadContent::WEBHOOKS * count($ids), $largest, json_encode($notifications),
    ));
});

it('closes the old items of 20 projects in one night', function () use ($within) {
    $days = AutomationKey::AutoClose->defaults()['days'];
    foreach (Project::query()->orderBy('identifier')->get() as $project) {
        $canceled = WorkflowState::query()->where('workflow_id', $project->workflow_id)
            ->where('category', StateCategory::Canceled)->orderBy('position')->orderBy('id')->value('id');
        Automation::factory()->for($project)->key(AutomationKey::AutoClose)->enabled(['days' => $days, 'state_id' => $canceled])->create();
    }

    // the candidates as the night reads them: open (Backlog, Unstarted), not archived, no activity for `$days` days
    $candidates = WorkItem::query()->whereNull('archived_at')
        ->whereIn('state_id', WorkflowState::query()->whereIn('category', [StateCategory::Backlog, StateCategory::Unstarted])->select('id'))
        ->whereRaw('greatest(work_items.updated_at, coalesce((select max(comments.created_at) from comments where comments.work_item_id = work_items.id), work_items.updated_at)) <= ?', [now()->subDays($days)->format('Y-m-d H:i:s.u')])
        ->count();
    expect($candidates)->toBeGreaterThan(5_000);

    $name = 'night: Auto-Close over L01–L20';
    $counts = Budget::once($name, fn () => RunDailyAutomations::run(
        Actor::system(User::defaultBot(), 'daily_automations'), now()->utc()->startOfHour()->toImmutable(), true,
    ), WORK_ROWS[$name]);

    // every candidate closed or refused by its workflow, none passed over; the memory does not grow with the items
    expect($counts['closed'] + $counts['skipped'])->toBe($candidates)
        ->and($counts['closed'])->toBeGreaterThan(0)
        ->and($counts['archived'])->toBe(0)
        ->and(Budget::row($name)['memory'] * 1_048_576)->toBeLessThanOrEqual(NIGHT_MEMORY);
    $within($name);

    fwrite(STDERR, sprintf(
        "\n%s: %d candidates, closed %d, skipped %d, peak %.0f MB\n",
        $name, $candidates, $counts['closed'], $counts['skipped'], Budget::row($name)['memory'],
    ));
});

it('queues 50 due templates', function () use ($within) {
    $due = Template::query()->whereNotNull('schedule')->pluck('id')->all();
    expect($due)->toHaveCount(LoadContent::SCHEDULED);
    Template::query()->whereKey($due)->update(['next_run_at' => now()->subMinute()]);

    // the queue of production: one row in `jobs` per template, inside the transaction of the test
    config(['queue.default' => 'database']);
    $name = 'scheduler: queue 50 due templates';
    $queued = Budget::once($name, fn () => RunDueTemplates::run(Actor::system(User::defaultBot(), 'templates')), WORK_ROWS[$name]);

    expect($queued)->toBe(LoadContent::SCHEDULED)
        ->and(DB::table('jobs')->pluck('payload')->map(fn (string $payload) => json_decode($payload, true)['displayName'])->all())
        ->toBe(array_fill(0, LoadContent::SCHEDULED, RunTemplateJob::class));
    $within($name);
});

it('copies 20 pictures of 2 MB in a template run', function () use ($within) {
    Storage::fake('local');
    $disk = storage_path('framework/testing/disks/local');

    try {
        // a preview is the work of the queue `media`, not of the run
        Queue::fake([PerformConversionsJob::class, DeliverWebhook::class]);
        $admin = User::query()->where('handle', 'load-01')->sole();
        $project = Project::query()->where('identifier', 'L01')->sole();
        $template = Template::factory()->create(['project_id' => $project->id, 'name' => 'Vorlage mit Bildern']);

        // an uncompressed PNG of 2 MB (836 × 836 pixels, RGB)
        $image = imagecreatetruecolor(836, 836);
        ob_start();
        imagepng($image, null, 0);
        $png = (string) ob_get_clean();
        expect(strlen($png))->toBeGreaterThanOrEqual(PICTURE_BYTES);

        $pictures = [];
        for ($n = 1; $n <= PICTURES; $n++) {
            $pictures[] = Attachment::factory()->forTemplate($template)->stored($png, 'image/png', "bild-{$n}.png")
                ->create(['uploaded_by' => $admin->id]);
        }
        $description = ['type' => 'doc', 'content' => array_map(
            fn (Attachment $picture) => ['type' => 'image', 'attrs' => ['attachmentId' => $picture->id, 'alt' => $picture->filename]],
            $pictures,
        )];
        $template->update(['payload' => ['description' => $description] + $template->payload]);
        $template->refresh();

        $bytes = function () use ($disk): int {
            $files = (new Filesystem)->allFiles($disk);

            return array_sum(array_map(fn (SplFileInfo $file) => (int) $file->getSize(), $files));
        };

        // the copies alone, as a run makes them before any lock
        $name = 'template run: copy 20 pictures of 2 MB';
        $before = $bytes();
        $texts = Budget::once($name, fn () => TemplateAttachments::copy(
            $template, ['description_json' => Document::fromJson($description)], User::defaultBot(),
        ), WORK_ROWS[$name]);
        $copied = $bytes() - $before;
        expect($texts['description_json']?->attachmentIds())->toHaveCount(PICTURES)
            ->and(array_intersect($texts['description_json']?->attachmentIds() ?? [], array_column($pictures, 'id')))->toBe([])
            ->and($copied)->toBeGreaterThanOrEqual(PICTURES * PICTURE_BYTES)
            ->and(Budget::row($name)['memory'] * 1_048_576)->toBeLessThanOrEqual(COPY_MEMORY);
        $within($name);

        // the whole run: the copies, then the item under the locks
        $name = 'template run with 20 pictures of 2 MB';
        $before = $bytes();
        $result = Budget::once($name, fn () => RunTemplate::execute($template, null, $admin), WORK_ROWS[$name]);
        $run = $bytes() - $before;
        expect($result)->not->toBeNull();
        $item = $result['item'];
        expect($item)->toBeInstanceOf(WorkItem::class);
        $named = Document::fromJson($item->description)->attachmentIds();
        expect($named)->toHaveCount(PICTURES)
            ->and(Attachment::query()->whereKey($named)->where('attachable_id', $item->id)->count())->toBe(PICTURES)
            ->and($run)->toBeGreaterThanOrEqual(PICTURES * PICTURE_BYTES)
            ->and(Budget::row($name)['memory'] * 1_048_576)->toBeLessThanOrEqual(COPY_MEMORY);
        $within($name);

        fwrite(STDERR, sprintf(
            "\ntemplate run: copy %.0f MB on the disk, peak %.0f MB; run %.0f MB on the disk, peak %.0f MB\n",
            $copied / 1_048_576, Budget::row('template run: copy 20 pictures of 2 MB')['memory'], $run / 1_048_576, Budget::row($name)['memory'],
        ));
    } finally {
        // the fake disk sits in the repository (Mutagen syncs it): 120 MB of pictures go with the test
        (new Filesystem)->deleteDirectory($disk);
    }
});

it('names only rows that exist', function () {
    foreach (WORK_OVER_BUDGET as $name => $reason) {
        expect(WORK_ROWS)->toHaveKey($name, message: "WORK_OVER_BUDGET names {$name}, which is no row");
        expect($reason)->toMatch('/^Task \d+[a-z]?: \S/', "the reason of {$name} names no task");
    }

    expect(array_keys(WORK_ROWS))->toHaveCount(6);
});

afterAll(function () {
    $over = [...(defined('OVER_BUDGET') ? OVER_BUDGET : []), ...WORK_OVER_BUDGET];
    Budget::write($over);
    fwrite(STDERR, "\n".Budget::table($over)."\n");
});
