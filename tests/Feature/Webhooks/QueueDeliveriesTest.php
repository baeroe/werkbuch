<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\AddReaction;
use App\Actions\Pages\CreatePage;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\RemoveMember;
use App\Actions\Projects\UpdateProject;
use App\Actions\Users\DeactivateUser;
use App\Actions\Webhooks\QueueDeliveries;
use App\Actions\Webhooks\SaveWebhook;
use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Events\Outbox;
use App\Jobs\DeliverWebhook;
use App\Jobs\PurgeProject;
use App\Models\Comment;
use App\Models\Event;
use App\Models\EventConsumption;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Webhooks\WebhookBackoff;
use App\Webhooks\WebhookConsumer;
use App\Webhooks\WebhookPayload;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\Support\RichTextFixtures as F;

/*
 * The consumer `webhooks` turns an event into one delivery per webhook that takes it (task 6, A364, A370, K9, K16): only
 * rows in the claim transaction, the jobs after the commit, and an event that arrives twice queues nothing twice.
 * The consumer is on (real actions consume their events); tests that consume late switch it off and use the outbox.
 */

beforeEach(function () {
    Storage::fake('local');
    consumers(WebhookConsumer::class);
});

/**
 * WEB (private) with Mara as org admin, project admin and lead, and the bots Kira and Otto as members; OPS (public)
 * with Mara as admin.
 *
 * @return array{mara: User, web: Project, ops: Project, kira: User, otto: User}
 */
$world = function (): array {
    $mara = User::factory()->admin()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->private()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $kira = User::factory()->bot($mara)->create(['name' => 'Kira', 'handle' => 'kira']);
    $otto = User::factory()->bot($mara)->create(['name' => 'Otto', 'handle' => 'otto']);
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);
    app(RoleAssignments::class)->setProjectRole($otto, $web, ProjectRole::Member);

    return compact('mara', 'web', 'ops', 'kira', 'otto');
};

$create = fn (User $user, Project $project, array $input = []): WorkItem => CreateWorkItem::run(actor($user), ['project_id' => $project->id, 'title' => 'Formular prüfen', ...$input]);

/** The events of the deliveries of a webhook, in the order they came. */
$delivered = fn (Webhook $webhook): array => WebhookDelivery::query()->where('webhook_id', $webhook->id)
    ->orderBy('created_at')->orderBy('id')->pluck('event')->all();

$consume = fn (Event $event): bool => app(Outbox::class)->consume($event->id, WebhookConsumer::class);

$system = fn (): Actor => Actor::system(User::defaultBot(), 'webhooks');

/** The `bot.assigned` that creating the item for the bot recorded (task 10): subject the item, `meta.bot_id` the bot. */
$botAssigned = fn (User $mara, WorkItem $item, User $bot): Event => eventsOf(EventType::BotAssigned, $item)->sole();

it('queues one delivery per matching webhook, with the body of its reader', function () use ($world, $create, $delivered) {
    Queue::fake([DeliverWebhook::class]);
    $w = $world();
    $all = Webhook::factory()->create(['events' => ['work_item.*']]);
    $created = Webhook::factory()->create(['events' => ['work_item.created']]);
    $comments = Webhook::factory()->create(['events' => ['comment.*']]);

    $item = $create($w['mara'], $w['ops']);

    $event = eventsOf(EventType::WorkItemCreated, $item)->sole();
    $deliveries = WebhookDelivery::query()->orderBy('webhook_id')->get();
    $body = json_encode(WebhookPayload::for($event, User::defaultBot()), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    expect($delivered($all))->toBe(['work_item.created'])
        ->and($delivered($created))->toBe(['work_item.created'])
        ->and($delivered($comments))->toBe([])
        ->and($deliveries->pluck('event_id')->unique()->all())->toBe([$event->id])
        ->and($deliveries->pluck('status')->unique()->all())->toBe([WebhookDelivery::PENDING])
        ->and($deliveries->pluck('attempts')->unique()->all())->toBe([0])
        // without a bot both read as the default bot: one body, as it goes out
        ->and($deliveries->pluck('body')->unique()->all())->toBe([$body])
        ->and($body)->toContain('"title":"Formular prüfen"')
        ->and(eventsOf(EventType::WorkItemCreated, $item))->toHaveCount(1);

    Queue::assertPushed(DeliverWebhook::class, 2);
    expect(Queue::pushed(DeliverWebhook::class)->map(fn (DeliverWebhook $job) => $job->uuid)->sort()->values()->all())
        ->toBe($deliveries->pluck('id')->sort()->values()->all());
});

it('queues a job spatie can send, without body, URL, secret and signature, after the commit (K1, K7, T6-M4)', function () use ($world, $create) {
    Queue::fake([DeliverWebhook::class]);
    $w = $world();
    $webhook = Webhook::factory()->create(['url' => 'https://receiver.example.com/hook?token=t0k3n']);

    $create($w['mara'], $w['ops']);

    $delivery = WebhookDelivery::query()->sole();
    Queue::assertPushedOn('webhooks', DeliverWebhook::class, fn (DeliverWebhook $job) => $job->uuid === $delivery->id
        && $job->webhookUrl === DeliverWebhook::PLACEHOLDER_URL && ! str_contains(serialize($job), 't0k3n')
        && $job->meta === ['delivery_id' => $delivery->id, 'kind' => 'scheduled']
        && $job->payload === '' && $job->getBody() === ''
        && $job->httpVerb === 'post' && $job->verifySsl === true && $job->tries === 8 && $job->requestTimeout === 10
        && $job->backoffStrategyClass === WebhookBackoff::class && $job->throwExceptionOnFailure === false && $job->proxy === null
        && $job->headers === ['Content-Type' => 'application/json']
        && $job->afterCommit === true);
});

it('waits between the tries as the plan says (A365)', function () {
    $backoff = new WebhookBackoff;

    expect(array_map(fn (int $attempt) => $backoff->waitInSecondsAfterAttempt($attempt), range(1, 7)))
        ->toBe([60, 300, 1800, 7200, 21600, 43200, 12240]);
});

it('sends the delivery after the commit, signed, and logs the attempt (task 7)', function () use ($world, $create) {
    $w = $world();
    Webhook::factory()->create(['url' => 'https://receiver.example.com/hook']);
    resolver(['receiver.example.com' => ['93.184.216.34']]);
    Http::fake(['*' => Http::response('ok')]);

    $create($w['mara'], $w['ops']);

    // the sync queue of the tests ran the job at the commit
    Http::assertSent(fn (Request $request) => $request->header('X-Werkbuch-Event') === ['work_item.created']
        && $request->body() === WebhookDelivery::query()->sole()->body);
    expect(WebhookDelivery::query()->sole()->only(['status', 'attempts']))->toBe(['status' => WebhookDelivery::SUCCEEDED, 'attempts' => 1]);
});

it('skips an event the webhook did not choose', function () use ($world, $create, $delivered) {
    Queue::fake([DeliverWebhook::class]);
    $w = $world();
    $webhook = Webhook::factory()->create(['events' => ['work_item.updated']]);

    $item = $create($w['mara'], $w['ops']);
    expect($delivered($webhook))->toBe([]);

    UpdateWorkItem::run(actor($w['mara']), $item, ['title' => 'Formular testen']);
    expect($delivered($webhook))->toBe(['work_item.updated']);
});

it('gives a project webhook only events of its project', function () use ($world, $create, $delivered) {
    Queue::fake([DeliverWebhook::class]);
    $w = $world();
    $web = Webhook::factory()->forProject($w['web'])->create();
    $org = Webhook::factory()->create();

    $inWeb = $create($w['mara'], $w['web']);
    $inOps = $create($w['mara'], $w['ops']);

    expect(WebhookDelivery::query()->where('webhook_id', $web->id)->pluck('event_id')->all())
        ->toBe([eventsOf(EventType::WorkItemCreated, $inWeb)->sole()->id])
        ->and($delivered($org))->toBe(['work_item.created', 'work_item.created'])
        ->and(WebhookDelivery::query()->where('webhook_id', $org->id)->pluck('event_id')->sort()->values()->all())
        ->toBe(collect([eventsOf(EventType::WorkItemCreated, $inWeb)->sole()->id, eventsOf(EventType::WorkItemCreated, $inOps)->sole()->id])->sort()->values()->all());
});

it('sends project.deleted to organization webhooks only, and nothing of a project being deleted (A370)', function () use ($world, $create, $delivered, $consume) {
    Queue::fake([DeliverWebhook::class, PurgeProject::class]);
    $w = $world();
    $org = Webhook::factory()->create(['events' => ['project.*', 'work_item.*']]);
    $own = Webhook::factory()->forProject($w['web'])->create(['events' => ['project.*', 'work_item.*']]);
    $item = $create($w['mara'], $w['web']);

    // an event the consumer takes only after the project went into deletion
    consumers();
    UpdateWorkItem::run(actor($w['mara']), $item, ['title' => 'Formular testen']);
    DeleteProject::run(actor($w['mara']), $w['web']);

    expect($consume(eventsOf(EventType::WorkItemUpdated, $item)->sole()))->toBeTrue()
        ->and($consume(eventsOf(EventType::ProjectDeleted)->sole()))->toBeTrue()
        ->and($delivered($org))->toBe(['work_item.created', 'project.deleted'])
        ->and($delivered($own))->toBe(['work_item.created']);

    // also once the project is purged
    WebhookDelivery::query()->where('event', 'project.deleted')->delete();
    EventConsumption::query()->delete();
    PurgeProject::dispatchSync($w['web']->id, $w['mara']->id);
    expect($consume(eventsOf(EventType::ProjectDeleted)->sole()))->toBeTrue()
        ->and($consume(eventsOf(EventType::WorkItemUpdated, $item)->sole()))->toBeTrue()
        ->and($delivered($org))->toBe(['work_item.created', 'project.deleted']);
});

it('skips events without a webhook, without a query', function () use ($world, $create, $system) {
    Queue::fake([DeliverWebhook::class]);
    $w = $world();
    // patterns the form would refuse: they match nothing outside the catalog either
    Webhook::factory()->create(['events' => ['workflow.*', 'comment.*', 'webhook.*']]);
    consumers();
    $item = $create($w['mara'], $w['ops']);
    AddComment::run(actor($w['mara']), $item, ['body' => 'Sieht gut aus.']);
    AddReaction::run(actor($w['mara']), Comment::query()->sole(), ['emoji' => '👍']);
    SaveWebhook::run(actor($w['mara']), ['name' => 'Neu', 'url' => 'https://receiver.example.com/new', 'project_id' => null, 'events' => ['comment.*'], 'bot_id' => null, 'active' => true]);
    DB::transaction(fn () => EventRecorder::record(EventType::WorkflowUpdated, actor($w['mara']), Workflow::default(), null));
    $actor = $system();

    foreach ([EventType::WorkflowUpdated, EventType::CommentReactionAdded, EventType::WebhookCreated] as $type) {
        $event = eventsOf($type)->sole();
        DB::flushQueryLog();
        DB::enableQueryLog();
        $queued = QueueDeliveries::run($actor, $event);
        DB::disableQueryLog();

        expect($queued)->toBe(0)
            ->and(DB::getQueryLog())->toBe([]);
    }
    expect(WebhookDelivery::query()->count())->toBe(0);
});

it('filters by bot: its own bot events, the events of its items, nothing of an item of another account (A364, K9)', function () use ($world, $create, $delivered, $botAssigned) {
    Queue::fake([DeliverWebhook::class]);
    $w = $world();
    $kira = Webhook::factory()->forBot($w['kira'])->create(['events' => ['bot.*', 'work_item.*', 'comment.*']]);
    $org = Webhook::factory()->create(['events' => ['work_item.relation_added']]);
    $mention = fn (User $bot) => ['body_json' => F::doc(F::p(F::mention($bot->id, $bot->handle), ' bitte prüfen'))];
    $secret = Project::factory()->identifier('PRV')->private()->member($w['mara'], ProjectRole::Admin)->create(['lead_id' => $w['mara']->id]);

    $mine = $create($w['mara'], $w['web'], ['assignee_id' => $w['kira']->id]);
    $other = $create($w['mara'], $w['web'], ['assignee_id' => $w['otto']->id]);
    AddComment::run(actor($w['mara']), $mine, $mention($w['kira']));
    AddComment::run(actor($w['mara']), $other, $mention($w['otto']));
    $botAssigned($w['mara'], $other, $w['otto']);
    $botAssigned($w['mara'], $mine, $w['kira']);
    AddRelation::run(actor($w['mara']), $mine, ['type_id' => RelationType::query()->where('built_in', 'relates')->firstOrFail()->id, 'target_id' => $create($w['mara'], $secret)->id]);
    expect($delivered($kira))->toBe(['work_item.created', 'bot.assigned', 'comment.created', 'bot.mentioned', 'work_item.relation_added']);

    // each body reads as its reader: Kira does not see the other end, the organization does (A363)
    $relation = fn (Webhook $webhook): array => json_decode(WebhookDelivery::query()->where('webhook_id', $webhook->id)
        ->where('event_id', eventsOf(EventType::WorkItemRelationAdded, $mine)->sole()->id)->sole()->body, true)['changes']['relation']['new'];
    expect($relation($kira))->toHaveKey('hidden', true)->not->toHaveKey('key')
        ->and($relation($org))->toHaveKey('key', 'PRV-1');

    // it hears that it lost its item, then nothing more of it
    UpdateWorkItem::run(actor($w['mara']), $mine, ['assignee_id' => $w['mara']->id]);
    UpdateWorkItem::run(actor($w['mara']), $mine, ['title' => 'Formular testen']);
    UpdateWorkItem::run(actor($w['mara']), $other, ['title' => 'Formular testen']);
    expect(array_slice($delivered($kira), 5))->toBe(['work_item.assigned']);

    // and that its item was deleted
    $third = $create($w['mara'], $w['web'], ['assignee_id' => $w['kira']->id]);
    DeleteWorkItem::run(actor($w['mara']), $third);
    DeleteWorkItem::run(actor($w['mara']), $other);
    expect(array_slice($delivered($kira), 6))->toBe(['work_item.created', 'bot.assigned', 'work_item.deleted'])
        ->and(eventsOf(EventType::WorkItemDeleted, $third)->sole()->meta)->toMatchArray(['assignee_id' => $w['kira']->id]);
});

it('sends nothing to a bot webhook once the bot lost the private project or went inactive (T5-M1)', function () use ($world, $create, $delivered, $botAssigned) {
    Queue::fake([DeliverWebhook::class]);
    $w = $world();
    $kira = Webhook::factory()->forBot($w['kira'])->create(['events' => ['bot.*', 'work_item.*', 'comment.*']]);
    $otto = Webhook::factory()->forBot($w['otto'])->create(['events' => ['bot.*', 'work_item.*', 'comment.*']]);
    $org = Webhook::factory()->create(['events' => ['work_item.*']]);
    $hers = $create($w['mara'], $w['web'], ['assignee_id' => $w['kira']->id]);
    $his = $create($w['mara'], $w['web'], ['assignee_id' => $w['otto']->id]);

    RemoveMember::run(actor($w['mara']), $w['web'], $w['kira']);
    DeactivateUser::run(actor($w['mara']), $w['otto']);
    foreach ([$hers, $his] as $item) {
        UpdateWorkItem::run(actor($w['mara']), $item, ['title' => 'Formular testen']);
    }
    $botAssigned($w['mara'], $hers, $w['kira']);
    $botAssigned($w['mara'], $his, $w['otto']);
    DeleteWorkItem::run(actor($w['mara']), $hers);
    DeleteWorkItem::run(actor($w['mara']), $his);

    expect($delivered($kira))->toBe(['work_item.created', 'bot.assigned'])
        ->and($delivered($otto))->toBe(['work_item.created', 'bot.assigned'])
        ->and($delivered($org))->toBe(['work_item.created', 'work_item.created', 'work_item.updated', 'work_item.updated', 'work_item.deleted', 'work_item.deleted']);
});

it('gives a bot webhook nothing of a project, a page or a public project it only reads', function () use ($world, $create, $delivered) {
    Queue::fake([DeliverWebhook::class]);
    $w = $world();
    $kira = Webhook::factory()->forBot($w['kira'])->create(['events' => Webhook::catalog()]);

    // OPS is public: Kira sees it, but nothing there is hers
    $create($w['mara'], $w['ops']);
    UpdateWorkItem::run(actor($w['mara']), $create($w['mara'], $w['web']), ['title' => 'Formular testen']);
    // WEB it sees as a member: neither the project nor its pages are its own
    UpdateProject::run(actor($w['mara']), $w['web'], ['name' => 'Website neu']);
    CreatePage::run(actor($w['mara']), $w['web'], ['title' => 'Ablauf']);

    expect(eventsOf(EventType::ProjectUpdated))->toHaveCount(1)
        ->and(eventsOf(EventType::PageCreated))->toHaveCount(1)
        ->and($delivered($kira))->toBe([]);
});

it('skips an inactive and a disabled webhook', function () use ($world, $create, $delivered) {
    Queue::fake([DeliverWebhook::class]);
    $w = $world();
    $off = Webhook::factory()->create(['active' => false]);
    $disabled = Webhook::factory()->disabled()->create();
    $halfway = Webhook::factory()->create(['disabled_at' => now()]);
    $on = Webhook::factory()->create();

    $create($w['mara'], $w['ops']);

    expect($delivered($off))->toBe([])
        ->and($delivered($disabled))->toBe([])
        ->and($delivered($halfway))->toBe([])
        ->and($delivered($on))->toBe(['work_item.created']);
});

it('consumes twice and queues once, also without the claim (Review Focus 1)', function () use ($world, $create, $consume, $system) {
    Queue::fake([DeliverWebhook::class]);
    $w = $world();
    Webhook::factory()->count(2)->create();
    consumers();
    $item = $create($w['mara'], $w['ops']);
    $event = eventsOf(EventType::WorkItemCreated, $item)->sole();

    expect($consume($event))->toBeTrue()
        ->and($consume($event))->toBeFalse()
        ->and(WebhookDelivery::query()->count())->toBe(2);

    // queue:retry of a job that lost its claim: the unique key of the delivery holds
    EventConsumption::query()->where('event_id', $event->id)->delete();
    expect($consume($event))->toBeTrue()
        ->and(QueueDeliveries::run($system(), $event))->toBe(0)
        ->and(WebhookDelivery::query()->count())->toBe(2);
    Queue::assertPushed(DeliverWebhook::class, 2);
});

it('queues nothing when the claim rolls back, and the job after the commit without body or secret', function () use ($world, $create, $consume) {
    config(['queue.default' => 'database']);
    $w = $world();
    $webhook = Webhook::factory()->create();
    consumers();
    $item = $create($w['mara'], $w['ops'], ['title' => 'Marker-7f3a']);
    $event = eventsOf(EventType::WorkItemCreated, $item)->sole();
    $jobs = fn () => DB::table('jobs')->where('queue', 'webhooks')->get();

    expect(fn () => DB::transaction(function () use ($consume, $event) {
        $consume($event);

        throw new RuntimeException('The job dies after the work.');
    }))->toThrow(RuntimeException::class, 'The job dies after the work.')
        ->and(WebhookDelivery::query()->count())->toBe(0)
        ->and($jobs())->toHaveCount(0);

    expect($consume($event))->toBeTrue()
        ->and(WebhookDelivery::query()->sole()->body)->toContain('Marker-7f3a')
        ->and($jobs())->toHaveCount(1)
        ->and((string) $jobs()->sole()->payload)->not->toContain('Marker-7f3a')
        ->and((string) $jobs()->sole()->payload)->not->toContain(base64_encode(serialize('Marker-7f3a')))
        ->and((string) $jobs()->sole()->payload)->not->toContain($webhook->secret);
});

it('keeps a body within its limit: first without changes, then without data (T5-M2)', function () {
    $envelope = ['id' => 'e', 'event' => 'work_item.updated', 'occurred_at' => 't', 'actor' => null, 'project' => null];
    $big = str_repeat('a', WebhookPayload::MAX_BYTES);
    $small = ['title' => 'Über https://example.com/x'];

    expect(WebhookPayload::encode([...$envelope, 'data' => $small, 'changes' => ['title' => ['old' => 'a', 'new' => 'b']]]))
        ->toBe('{"id":"e","event":"work_item.updated","occurred_at":"t","actor":null,"project":null,"data":{"title":"Über https://example.com/x"},"changes":{"title":{"old":"a","new":"b"}}}')
        ->and(json_decode(WebhookPayload::encode([...$envelope, 'data' => $small, 'changes' => ['description' => ['old' => $big, 'new' => null]]]), true))
        ->toBe([...$envelope, 'data' => $small, 'changes' => null])
        ->and(json_decode(WebhookPayload::encode([...$envelope, 'data' => ['description' => $big], 'changes' => ['title' => ['old' => 'a', 'new' => 'b']]]), true))
        ->toBe([...$envelope, 'data' => null, 'changes' => null]);

    // just at the limit it stays whole
    $fill = str_repeat('a', WebhookPayload::MAX_BYTES - strlen(WebhookPayload::encode([...$envelope, 'data' => ['d' => ''], 'changes' => null])));
    expect(strlen(WebhookPayload::encode([...$envelope, 'data' => ['d' => $fill], 'changes' => null])))->toBe(WebhookPayload::MAX_BYTES)
        ->and(json_decode(WebhookPayload::encode([...$envelope, 'data' => ['d' => $fill.'a'], 'changes' => null]), true)['data'])->toBeNull();
});
