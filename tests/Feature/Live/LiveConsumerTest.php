<?php

use App\Access\ProjectRole;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\AddReaction;
use App\Actions\Labels\SaveLabel;
use App\Actions\Projects\AddMember;
use App\Actions\Projects\UpdateProject;
use App\Actions\Tokens\CreateToken;
use App\Actions\Users\UpdateUserRole;
use App\Actions\Views\DeleteView;
use App\Actions\WorkItems\SetSubscription;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventType;
use App\Events\Outbox;
use App\Live\LiveConsumer;
use App\Models\EventConsumption;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use App\Search\SearchConsumer;
use Illuminate\Broadcasting\BroadcastException;
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

/** The six keys of every message about an event (A279). */
$message = fn (string $eventId, string $type, ?string $project, ?string $item, ?string $comment, string $actor) => [
    'event_id' => $eventId, 'type' => $type, 'project_id' => $project, 'item_id' => $item, 'comment_id' => $comment, 'actor_id' => $actor,
];

it('is a consumer of every event, in the queue live, without retries', function () {
    $consumer = new LiveConsumer;

    expect((require repo_path('config/werkbuch.php'))['event_consumers'])->toBe([SearchConsumer::class, NotificationConsumer::class, LiveConsumer::class])
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
