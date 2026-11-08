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
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\UpdateProject;
use App\Actions\Templates\DeleteTemplate;
use App\Actions\Templates\RunTemplate;
use App\Actions\Templates\SaveTemplate;
use App\Actions\Tokens\CreateToken;
use App\Actions\Users\UpdateUserRole;
use App\Actions\Views\DeleteView;
use App\Actions\WorkItems\RedistributeRanks;
use App\Actions\WorkItems\SetSubscription;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Events\Outbox;
use App\Live\LiveConsumer;
use App\Live\LiveMessage;
use App\Models\Automation;
use App\Models\EventConsumption;
use App\Models\Notification;
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

it('sends new ranks of a project to its channel, and the search and the notifications pass over them (A448)', function () use ($world, $message) {
    $engine = searchEngine();
    consumers(LiveConsumer::class, SearchConsumer::class, NotificationConsumer::class);
    $w = $world();
    DB::table('work_items')->where('id', $w['item']->id)->update(['rank' => 'a0VVV']);

    expect(RedistributeRanks::run(actor($w['mara']), $w['web']))->toBe(1);

    $event = eventsOf(EventType::ProjectRanksRedistributed, $w['web'])->sole();
    expect($this->live->sent())->toBe([
        ['channels' => ["private-project.{$w['web']->id}"], 'event' => 'live', 'payload' => $message($event->id, 'project.ranks_redistributed', $w['web']->id, null, null, $w['mara']->id), 'socket' => null],
    ])->and($engine->writes())->toBe(0)
        ->and(Notification::query()->count())->toBe(0)
        ->and(EventConsumption::query()->where('event_id', $event->id)->pluck('consumer')->sort()->values()->all())->toBe(['live', 'notifications', 'search']);
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

/*
 * People who see a project before they listen to it (A451): a new project nobody holds yet, a project that turned
 * public only its members and the org admins hold. They hear it on their own channel, if Visibility says they see it.
 */

/** The messages of an event on the own channels of people, in order: the accounts each one names. */
$toPeople = fn (array $sent, string $eventId) => array_values(array_map(
    fn (array $message) => array_map(fn (string $channel) => substr($channel, strlen('presence-user.')), $message['channels']),
    array_filter($sent, fn (array $message) => $message['payload']['event_id'] === $eventId && str_starts_with($message['channels'][0], 'presence-user.')),
));

it('tells everyone who sees a new public project on their own channel', function () use ($world, $message) {
    $w = $world();
    $ida = User::factory()->create(['name' => 'Ida']);
    // left out below: Mara (the actor), Gerd (deactivated), Kira and the default bot (bots)
    User::factory()->disabled()->create(['name' => 'Gerd']);
    User::factory()->bot()->create(['name' => 'Kira']);

    $project = CreateProject::run(actor($w['mara']), ['name' => 'Neues Projekt', 'identifier' => 'NEU']);

    $event = eventsOf(EventType::ProjectCreated, $project)->sole();
    $payload = $message($event->id, 'project.created', $project->id, null, null, $w['mara']->id);
    $people = collect([$w['tom'], $ida])->sortBy('id')->pluck('id')->all();
    expect($this->live->sent())->toBe([
        ['channels' => ["private-project.{$project->id}"], 'event' => 'live', 'payload' => $payload, 'socket' => null],
        ['channels' => array_map(fn (string $id) => "presence-user.{$id}", $people), 'event' => 'live', 'payload' => $payload, 'socket' => null],
    ]);
});

it('tells only members and org admins about a new private project', function () use ($world, $toPeople) {
    $w = $world();
    User::factory()->create(['name' => 'Ida']);
    $lene = User::factory()->create(['name' => 'Lene']);
    $erik = User::factory()->admin()->create(['name' => 'Erik']);

    $project = CreateProject::run(actor($w['mara']), ['name' => 'Geheim', 'identifier' => 'GEH', 'visibility' => 'private', 'lead_id' => $lene->id]);

    $event = eventsOf(EventType::ProjectCreated, $project)->sole();
    $heard = array_merge(...$toPeople($this->live->sent(), $event->id));
    sort($heard);
    // Lene as the lead is a member, Tom and Erik see every project; Ida does not see it, Mara made it
    $expected = [$lene->id, $w['tom']->id, $erik->id];
    sort($expected);
    expect($heard)->toBe($expected);
});

it('tells people about a project that turned public, with the socket of the change', function () use ($world, $message) {
    $w = $world();
    $ops = Project::factory()->identifier('OPS')->private()->member($w['tom'], ProjectRole::Admin)->create(['lead_id' => $w['tom']->id]);
    $ida = User::factory()->create(['name' => 'Ida']);

    $this->actingAs($w['tom'])->withHeader('X-Socket-ID', '1234.5678')
        ->patchJson("/api/v1/projects/{$ops->id}", ['visibility' => 'public'])->assertOk();

    $event = eventsOf(EventType::ProjectUpdated, $ops)->sole();
    $payload = $message($event->id, 'project.updated', $ops->id, null, null, $w['tom']->id);
    $people = collect([$w['mara'], $ida])->sortBy('id')->pluck('id')->all();
    expect($this->live->sent())->toBe([
        ['channels' => ["private-project.{$ops->id}"], 'event' => 'live', 'payload' => $payload, 'socket' => '1234.5678'],
        ['channels' => array_map(fn (string $id) => "presence-user.{$id}", $people), 'event' => 'live', 'payload' => $payload, 'socket' => '1234.5678'],
    ]);
});

it('tells nobody on their own channel about a change of a project that keeps its visibility', function () use ($world, $toPeople) {
    $w = $world();
    $ops = Project::factory()->identifier('OPS')->public()->member($w['tom'], ProjectRole::Admin)->create(['lead_id' => $w['tom']->id]);

    UpdateProject::run(actor($w['tom']), $ops, ['name' => 'Betrieb', 'visibility' => 'public']);
    UpdateProject::run(actor($w['tom']), $ops, ['visibility' => 'private']);

    $named = eventsOf(EventType::ProjectUpdated, $ops)->values();
    // the name alone, then public to private (those lose the project, Disconnect, A281): the project channel only
    expect($named)->toHaveCount(2)
        ->and($toPeople($this->live->sent(), $named[0]->id))->toBe([])
        ->and($toPeople($this->live->sent(), $named[1]->id))->toBe([])
        ->and(array_column($this->live->sent(), 'channels'))->toBe([["private-project.{$ops->id}"], ["private-project.{$ops->id}"]]);
});

it('sends a hundred channels per message', function () use ($world, $toPeople) {
    $w = $world();
    User::factory()->count(150)->create();

    $project = CreateProject::run(actor($w['mara']), ['name' => 'Alle', 'identifier' => 'ALLE']);

    $event = eventsOf(EventType::ProjectCreated, $project)->sole();
    $messages = $toPeople($this->live->sent(), $event->id);
    $heard = array_merge(...$messages);
    // the body of the first request to Reverb's HTTP API as the Pusher client builds it, well within its 10 000 bytes
    $full = collect($this->live->sent())->first(fn (array $sent) => count($sent['channels']) === LiveMessage::CHANNELS_MAX);
    $body = strlen((string) json_encode([
        'name' => 'live', 'data' => json_encode($full['payload']), 'channels' => $full['channels'], 'socket_id' => '1234567890.1234567890',
    ]));
    // Tom and the 150, without Mara: two messages, the first one full
    expect(LiveMessage::CHANNELS_MAX)->toBe(100)
        ->and($body)->toBeLessThan(7_000)
        ->and(array_map('count', $messages))->toBe([100, 51])
        ->and(array_unique($heard))->toHaveCount(151)
        ->and($heard)->toContain($w['tom']->id);
});

it('asks the same number of queries for 2 and 50 people', function () use ($world, $toPeople) {
    $w = $world();
    $queries = function (int $people, string $identifier) use ($w, $toPeople): array {
        User::factory()->count($people)->create();
        consumers();
        $project = CreateProject::run(actor($w['mara']), ['name' => "Privat {$identifier}", 'identifier' => $identifier, 'visibility' => 'private']);
        consumers(LiveConsumer::class);
        $event = eventsOf(EventType::ProjectCreated, $project)->sole();

        $count = 0;
        DB::listen(function () use (&$count) {
            $count++;
        });
        app(Outbox::class)->consume($event->id, LiveConsumer::class);

        return [$count, count(array_merge(...$toPeople($this->live->sent(), $event->id)))];
    };

    [$few, $fewHeard] = $queries(1, 'ZWEI');
    [$many, $manyHeard] = $queries(48, 'VIELE');

    // besides Mara, who makes the projects: Tom and one more person, then 48 more; each private project reaches Tom
    // only, and who sees it is read with the same queries however many people there are (with a member among them,
    // the members are read once)
    expect($fewHeard)->toBe(1)
        ->and($manyHeard)->toBe(1)
        ->and($many)->toBe($few);
});

it('tells nobody on their own channel about a project that is being deleted or gone', function () use ($world, $toPeople) {
    $w = $world();
    consumers();
    $deleting = CreateProject::run(actor($w['mara']), ['name' => 'Weg', 'identifier' => 'WEG']);
    $gone = CreateProject::run(actor($w['mara']), ['name' => 'Fort', 'identifier' => 'FORT']);
    consumers(LiveConsumer::class);
    $deleting->forceFill(['deleting_at' => now()])->save();
    $created = [eventsOf(EventType::ProjectCreated, $deleting)->sole(), eventsOf(EventType::ProjectCreated, $gone)->sole()];
    DB::table('projects')->where('id', $gone->id)->delete();

    foreach ($created as $event) {
        app(Outbox::class)->consume($event->id, LiveConsumer::class);
    }

    // the project channels still hear it (whoever holds one learns the project is going), no own channel does
    expect($toPeople($this->live->sent(), $created[0]->id))->toBe([])
        ->and($toPeople($this->live->sent(), $created[1]->id))->toBe([])
        ->and(array_column($this->live->sent(), 'channels'))->toBe([["private-project.{$deleting->id}"], ["private-project.{$gone->id}"]]);
});

it('sends nothing for catalog, view and token events', function () use ($world) {
    $w = $world();

    SaveLabel::run(actor($w['tom']), null, ['name' => 'Prüfung', 'color' => 'moss']);
    DeleteView::run(actor($w['tom']), View::factory()->create(['created_by' => $w['tom']->id]));
    CreateToken::run(actor($w['tom']), ['name' => 'Laptop', 'abilities' => ['read']]);

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
