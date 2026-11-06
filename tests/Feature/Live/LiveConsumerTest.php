<?php

use App\Access\ProjectRole;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\AddReaction;
use App\Actions\Labels\SaveLabel;
use App\Actions\Pages\CreatePage;
use App\Actions\Pages\DeletePage;
use App\Actions\Pages\MovePage;
use App\Actions\Pages\UpdatePage;
use App\Actions\Projects\AddMember;
use App\Actions\Projects\UpdateProject;
use App\Actions\Templates\DeleteTemplate;
use App\Actions\Templates\RunTemplate;
use App\Actions\Templates\SaveTemplate;
use App\Actions\Tokens\CreateToken;
use App\Actions\Users\UpdateUserRole;
use App\Actions\Views\DeleteView;
use App\Actions\WorkItems\SetSubscription;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Events\Outbox;
use App\Live\LiveConsumer;
use App\Live\LiveMessage;
use App\Models\Automation;
use App\Models\EventConsumption;
use App\Models\Page;
use App\Models\Project;
use App\Models\Template;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use App\Search\SearchConsumer;
use App\Webhooks\WebhookConsumer;
use Illuminate\Broadcasting\BroadcastException;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;

/*
 * The consumer `live` (Task 10, phase plan 8 "Live"): it tells the channels that something changed, with IDs only
 * (A279), leaves out the tab that made the change (A282) and keeps going when Reverb is down (A284, K1). WEB (public)
 * with Tom as its admin and lead and Mara as a member; Tom is an org admin. Broadcasts go to a RecordingBroadcaster.
 */

beforeEach(function () {
    $this->live = broadcasts();
    consumers(LiveConsumer::class);
});

$world = function (): array {
    $tom = User::factory()->admin()->create(['name' => 'Tom', 'handle' => 'tom']);
    $web = Project::factory()->identifier('WEB')->public()->member($tom, ProjectRole::Admin)->create(['lead_id' => $tom->id]);
    $mara = memberOf($web, ProjectRole::Member, ['name' => 'Mara', 'handle' => 'mara']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $tom->id, 'title' => 'Kontaktformular']);

    return compact('tom', 'web', 'mara', 'item');
};

/**
 * The eight keys of every message about an event (A279, A318): the page is null but on page events, the template but on
 * template events and on the `work_item.created` of a run (T14-I1/I2).
 */
$message = fn (string $eventId, string $type, ?string $project, ?string $item, ?string $comment, string $actor, ?string $page = null, ?string $template = null) => [
    'event_id' => $eventId, 'type' => $type, 'project_id' => $project, 'page_id' => $page, 'template_id' => $template, 'item_id' => $item, 'comment_id' => $comment, 'actor_id' => $actor,
];

it('is a consumer of every event, in the queue live, without retries', function () {
    $consumer = new LiveConsumer;

    expect((require repo_path('config/werkbuch.php'))['event_consumers'])->toBe([SearchConsumer::class, NotificationConsumer::class, LiveConsumer::class, WebhookConsumer::class])
        ->and($consumer->key())->toBe('live')
        ->and($consumer->queue())->toBe('live')
        ->and($consumer->tries())->toBe(1)
        ->and($consumer->backoff())->toBe([]);
});

it('sends a work item change to its project with ids only', function () use ($world, $message) {
    $w = $world();

    UpdateWorkItem::run(actor($w['mara']), $w['item'], ['title' => 'Geheimes Angebot', 'description' => 'Der Preis ist 4.200 €.']);

    $event = eventsOf(EventType::WorkItemUpdated, $w['item'])->sole();
    expect($this->live->sent())->toBe([[
        'channels' => ["private-project.{$w['web']->id}"],
        'event' => 'live',
        'payload' => $message($event->id, 'work_item.updated', $w['web']->id, $w['item']->id, null, $w['mara']->id),
        'socket' => null,
    ]])
        ->and(json_encode($this->live->sent()))->not->toContain('Geheim')->not->toContain('4.200');
});

it("sends a comment and a reaction to the item's channel", function () use ($world, $message) {
    $w = $world();

    $comment = AddComment::run(actor($w['mara']), $w['item'], ['body' => 'Sieht gut aus.']);
    AddReaction::run(actor($w['tom']), $comment, ['emoji' => '👍']);

    $created = eventsOf(EventType::CommentCreated, $w['item'])->sole();
    $reacted = eventsOf(EventType::CommentReactionAdded, $w['item'])->sole();
    $channel = ["private-work-item.{$w['item']->id}"];
    expect($this->live->sent())->toBe([
        ['channels' => $channel, 'event' => 'live', 'payload' => $message($created->id, 'comment.created', $w['web']->id, $w['item']->id, $comment->id, $w['mara']->id), 'socket' => null],
        ['channels' => $channel, 'event' => 'live', 'payload' => $message($reacted->id, 'comment.reaction_added', $w['web']->id, $w['item']->id, $comment->id, $w['tom']->id), 'socket' => null],
    ])
        ->and(json_encode($this->live->sent()))->not->toContain('Sieht gut aus');
});

it("sends a subscription to the person's channel", function () use ($world, $message) {
    $w = $world();

    SetSubscription::run(actor($w['mara']), $w['item'], true);
    SetSubscription::run(actor($w['mara']), $w['item'], false);

    $on = eventsOf(EventType::WorkItemSubscribed, $w['item'])->sole();
    $off = eventsOf(EventType::WorkItemUnsubscribed, $w['item'])->sole();
    $channel = ["presence-user.{$w['mara']->id}"];
    expect($this->live->sent())->toBe([
        ['channels' => $channel, 'event' => 'live', 'payload' => $message($on->id, 'work_item.subscribed', $w['web']->id, $w['item']->id, null, $w['mara']->id), 'socket' => null],
        ['channels' => $channel, 'event' => 'live', 'payload' => $message($off->id, 'work_item.unsubscribed', $w['web']->id, $w['item']->id, null, $w['mara']->id), 'socket' => null],
    ]);
});

it('sends a change of the project to its project', function () use ($world, $message) {
    $w = $world();

    UpdateProject::run(actor($w['tom']), $w['web'], ['name' => 'Website neu']);

    $event = eventsOf(EventType::ProjectUpdated, $w['web'])->sole();
    expect($this->live->sent())->toBe([[
        'channels' => ["private-project.{$w['web']->id}"],
        'event' => 'live',
        'payload' => $message($event->id, 'project.updated', $w['web']->id, null, null, $w['tom']->id),
        'socket' => null,
    ]])
        ->and($this->live->terminated())->toBe([]);
});

it('tells an added member on their own channel', function () use ($world, $message) {
    $w = $world();
    $ida = User::factory()->create(['name' => 'Ida']);

    AddMember::run(actor($w['tom']), $w['web'], ['user_id' => $ida->id, 'role' => 'member']);

    $event = eventsOf(EventType::ProjectMemberAdded, $w['web'])->sole();
    $payload = $message($event->id, 'project.member_added', $w['web']->id, null, null, $w['tom']->id);
    expect($this->live->sent())->toBe([
        ['channels' => ["private-project.{$w['web']->id}"], 'event' => 'live', 'payload' => $payload, 'socket' => null],
        ['channels' => ["presence-user.{$ida->id}"], 'event' => 'live', 'payload' => $payload, 'socket' => null],
    ]);
});

it('tells a person whose org role changed on their own channel', function () use ($world, $message) {
    $w = $world();

    UpdateUserRole::run(actor($w['tom']), $w['mara'], 'admin');

    $event = eventsOf(EventType::UserRoleChanged, $w['mara'])->sole();
    expect($this->live->sent())->toBe([[
        'channels' => ["presence-user.{$w['mara']->id}"],
        'event' => 'live',
        'payload' => $message($event->id, 'user.role_changed', null, null, null, $w['tom']->id),
        'socket' => null,
    ]])
        // a member who becomes admin loses nothing
        ->and($this->live->terminated())->toBe([]);
});

it('leaves out the tab that made the change', function () use ($world) {
    $w = $world();

    $this->actingAs($w['mara'])->withHeader('X-Socket-ID', '1234.5678')
        ->patchJson("/api/v1/work-items/{$w['item']->id}", ['title' => 'Kontaktformular neu'])->assertOk();

    expect($this->live->sent())->toHaveCount(1)
        ->and($this->live->sent()[0]['socket'])->toBe('1234.5678')
        ->and($this->live->sent()[0]['payload'])->not->toHaveKey('socket');
});

it('sends page events to the project channel with ids only', function () use ($world, $message) {
    $w = $world();

    $page = CreatePage::run(actor($w['mara']), $w['web'], ['title' => 'Geheime Preisliste', 'content' => 'Der Preis ist 4.200 €.']);
    $other = Page::factory()->create(['project_id' => $w['web']->id, 'title' => 'Ablauf']);
    UpdatePage::run(actor($w['tom']), $page, ['title' => 'Geheime Preisliste 2026', 'content' => 'Der Preis ist 4.800 €.']);
    MovePage::run(actor($w['mara']), $page, ['parent_id' => $other->id, 'before_id' => null]);

    $channel = ["private-project.{$w['web']->id}"];
    $sent = fn (EventType $type, User $actor) => [
        'channels' => $channel,
        'event' => 'live',
        'payload' => $message(eventsOf($type, $page)->sole()->id, $type->value, $w['web']->id, null, null, $actor->id, $page->id),
        'socket' => null,
    ];
    expect($this->live->sent())->toBe([
        $sent(EventType::PageCreated, $w['mara']),
        $sent(EventType::PageUpdated, $w['tom']),
        $sent(EventType::PageMoved, $w['mara']),
    ])
        ->and(json_encode($this->live->sent()))->not->toContain('Geheim')->not->toContain('Preis')->not->toContain('4.800')->not->toContain('Ablauf');
});

it('names the deleted subtree in page_ids', function () use ($world, $message) {
    $w = $world();
    $root = Page::factory()->create(['project_id' => $w['web']->id, 'title' => 'Geheimes Archiv']);
    $child = Page::factory()->childOf($root)->create();
    $grandchild = Page::factory()->childOf($child)->create();

    DeletePage::run(actor($w['tom']), $root);

    $event = eventsOf(EventType::PageDeleted, $root)->sole();
    expect($this->live->sent())->toBe([[
        'channels' => ["private-project.{$w['web']->id}"],
        'event' => 'live',
        'payload' => $message($event->id, 'page.deleted', $w['web']->id, null, null, $w['tom']->id, $root->id)
            + ['page_ids' => [$root->id, $child->id, $grandchild->id]],
        'socket' => null,
    ]])
        ->and(json_encode($this->live->sent()))->not->toContain('Geheim');
});

it('names a deleted subtree of up to 200 pages within what Reverb takes, and none beyond (T6-M3)', function () use ($world) {
    $w = $world();
    $large = Page::factory()->create(['project_id' => $w['web']->id]);
    Page::factory()->count(LiveMessage::PAGE_IDS_MAX)->childOf($large)->create();
    $largest = Page::factory()->create(['project_id' => $w['web']->id]);
    Page::factory()->count(LiveMessage::PAGE_IDS_MAX - 1)->childOf($largest)->create();

    DeletePage::run(actor($w['tom']), $largest);
    DeletePage::run(actor($w['tom']), $large);

    [$named, $unnamed] = array_column($this->live->sent(), 'payload');
    // the body of the request to Reverb's HTTP API as the Pusher client builds it; Reverb takes 10 000 bytes with the
    // request line (the signature in the query) and the headers, which stay far below 1 000
    $body = strlen((string) json_encode([
        'name' => 'live', 'data' => json_encode($named), 'channels' => ["private-project.{$w['web']->id}"], 'socket_id' => '1234567890.1234567890',
    ]));
    expect(LiveMessage::PAGE_IDS_MAX)->toBe(200)
        ->and($named['page_ids'])->toHaveCount(200)
        ->and($named['page_ids'][0])->toBe($largest->id)
        ->and($body)->toBeLessThan(9_000)
        // too many to name: the browser loads the tree again, what is not in it any more is gone
        ->and($unnamed['page_id'])->toBe($large->id)
        ->and($unnamed)->toHaveKey('page_ids', null);
});

it('names no pages when a page.deleted carries no page_ids (T10-M3)', function () use ($world) {
    $w = $world();
    $root = Page::factory()->create(['project_id' => $w['web']->id]);
    DeletePage::run(actor($w['tom']), $root);
    $event = eventsOf(EventType::PageDeleted, $root)->sole();
    $event->meta = array_diff_key($event->meta, ['page_ids' => true]);

    $payload = LiveMessage::of($event, new PrivateChannel("project.{$w['web']->id}"))->broadcastWith();

    // not an empty list (no page deleted): the browser marks the root and reads the tree for the rest
    expect($payload['page_id'])->toBe($root->id)
        ->and($payload)->toHaveKey('page_ids', null);
});

it('leaves out the tab that saved', function () use ($world) {
    $w = $world();
    $page = Page::factory()->create(['project_id' => $w['web']->id, 'created_by' => $w['mara']->id, 'updated_by' => $w['mara']->id]);

    $this->actingAs($w['mara'])->withHeader('X-Socket-ID', '1234.5678')
        ->patchJson("/api/v1/pages/{$page->id}", ['title' => 'Ablauf neu', 'base_version' => 1])->assertOk();

    expect($this->live->sent())->toHaveCount(1)
        ->and($this->live->sent()[0]['socket'])->toBe('1234.5678')
        ->and($this->live->sent()[0]['payload'])->not->toHaveKey('socket')
        ->and($this->live->sent()[0]['payload']['page_id'])->toBe($page->id);
});

it('sends template and automation events to the project channel with ids only, and the search passes over them (A347)', function () use ($world, $message) {
    $engine = searchEngine();
    consumers(LiveConsumer::class, SearchConsumer::class);
    $w = $world();

    $template = SaveTemplate::run(actor($w['mara']), $w['web'], ['name' => 'Wartung', 'payload' => ['title' => 'Wartung KW {week}'], 'schedule' => null]);
    SaveTemplate::run(actor($w['mara']), $w['web'], ['name' => 'Wöchentliche Wartung', 'payload' => ['title' => 'Wartung KW {week}'], 'schedule' => null], $template);
    $automation = Automation::factory()->for($w['web'])->create();
    DB::transaction(fn () => EventRecorder::record(EventType::AutomationUpdated, actor($w['tom']), $automation, $w['web'], ['enabled' => ['old' => false, 'new' => true]]));
    DeleteTemplate::run(actor($w['mara']), $template);

    $created = eventsOf(EventType::TemplateCreated, $template)->sole();
    $updated = eventsOf(EventType::TemplateUpdated, $template)->sole();
    $deleted = eventsOf(EventType::TemplateDeleted, $template)->sole();
    $switched = eventsOf(EventType::AutomationUpdated, $automation)->sole();
    $channel = ["private-project.{$w['web']->id}"];
    expect($this->live->sent())->toBe([
        ['channels' => $channel, 'event' => 'live', 'payload' => $message($created->id, 'template.created', $w['web']->id, null, null, $w['mara']->id, null, $template->id), 'socket' => null],
        ['channels' => $channel, 'event' => 'live', 'payload' => $message($updated->id, 'template.updated', $w['web']->id, null, null, $w['mara']->id, null, $template->id), 'socket' => null],
        ['channels' => $channel, 'event' => 'live', 'payload' => $message($switched->id, 'automation.updated', $w['web']->id, null, null, $w['tom']->id), 'socket' => null],
        ['channels' => $channel, 'event' => 'live', 'payload' => $message($deleted->id, 'template.deleted', $w['web']->id, null, null, $w['mara']->id, null, $template->id), 'socket' => null],
    ])->and($engine->writes())->toBe(0);
});

it('sends a failed run of a template to the project channel', function () use ($world, $message) {
    $w = $world();
    $template = Template::factory()->create(['project_id' => $w['web']->id, 'created_by' => $w['mara']->id]);
    $template->update(['payload' => [...$template->payload, 'assignee_id' => User::factory()->create()->id]]);

    RunTemplate::run(actor($w['mara']), $template);

    $failed = eventsOf(EventType::TemplateRunFailed, $template)->sole();
    expect($this->live->sent())->toBe([[
        'channels' => ["private-project.{$w['web']->id}"],
        'event' => 'live',
        'payload' => $message($failed->id, 'template.run_failed', $w['web']->id, null, null, User::defaultBot()->id, null, $template->id),
        'socket' => null,
    ]]);
});

it('names the template of the item a run created, so its log and its next run load again (T14-I1)', function () use ($world, $message) {
    $w = $world();
    $template = Template::factory()->create(['project_id' => $w['web']->id, 'created_by' => $w['mara']->id]);

    $item = RunTemplate::run(actor($w['mara']), $template)['item'];

    $created = eventsOf(EventType::WorkItemCreated, $item)->sole();
    expect($this->live->sent())->toBe([[
        'channels' => ["private-project.{$w['web']->id}"],
        'event' => 'live',
        'payload' => $message($created->id, 'work_item.created', $w['web']->id, $item->id, null, User::defaultBot()->id, null, $template->id),
        'socket' => null,
    ]]);
});

it('sends nothing for catalog, view and token events', function () use ($world) {
    $w = $world();

    SaveLabel::run(actor($w['tom']), null, ['name' => 'Prüfung', 'color' => 'moss']);
    DeleteView::run(actor($w['tom']), View::factory()->create(['created_by' => $w['tom']->id]));
    CreateToken::run(actor($w['tom']), $w['tom'], ['name' => 'Laptop', 'abilities' => ['read']]);

    // all three were taken by the consumer, none went anywhere
    expect(EventConsumption::query()->where('consumer', 'live')->count())->toBe(3)
        ->and($this->live->sent())->toBe([]);
});

it('keeps going when Reverb is down and reports once in ten minutes', function () use ($world) {
    $w = $world();
    Exceptions::fake();
    $this->live->failWith(new BroadcastException('Pusher error: cURL error 7: Failed to connect.'));

    UpdateWorkItem::run(actor($w['mara']), $w['item'], ['title' => 'Eins']);
    UpdateWorkItem::run(actor($w['mara']), $w['item'], ['title' => 'Zwei']);

    // each event is taken (no retry, nothing in failed_jobs) and the failure reported once
    expect(EventConsumption::query()->where('consumer', 'live')->count())->toBe(2);
    Exceptions::assertReportedCount(1);
    Exceptions::assertReported(BroadcastException::class);

    $this->travel(10)->minutes();
    $this->travel(1)->seconds();
    UpdateWorkItem::run(actor($w['mara']), $w['item'], ['title' => 'Drei']);
    Exceptions::assertReportedCount(2);

    // the failure of "Drei" holds the messages back for 30 seconds (A297), Reverb or not
    $this->live->failWith(null);
    UpdateWorkItem::run(actor($w['mara']), $w['item'], ['title' => 'Vier']);
    expect($this->live->sent())->toBe([]);
    $this->travel(31)->seconds();
    UpdateWorkItem::run(actor($w['mara']), $w['item'], ['title' => 'Fünf']);
    expect($this->live->sent())->toHaveCount(1);
});

it('keeps going against a Reverb that is not there', function () use ($world) {
    $w = $world();
    liveChannels();
    // nothing listens on the discard port: the connection is refused at once
    config(['broadcasting.connections.reverb.options.port' => 9]);
    Exceptions::fake();

    UpdateWorkItem::run(actor($w['mara']), $w['item'], ['title' => 'Eins']);

    expect(EventConsumption::query()->where('consumer', 'live')->count())->toBe(1);
    Exceptions::assertReportedCount(1);
    Exceptions::assertReported(BroadcastException::class);
});

it('sends an event once although its job arrives twice', function () use ($world) {
    $w = $world();
    consumers();
    UpdateWorkItem::run(actor($w['mara']), $w['item'], ['title' => 'Kontaktformular neu']);
    consumers(LiveConsumer::class);
    $event = eventsOf(EventType::WorkItemUpdated, $w['item'])->sole();

    $first = app(Outbox::class)->consume($event->id, LiveConsumer::class);
    $second = app(Outbox::class)->consume($event->id, LiveConsumer::class);

    expect([$first, $second])->toBe([true, false])
        ->and($this->live->sent())->toHaveCount(1);
});
