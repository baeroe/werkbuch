<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Comments\AddComment;
use App\Actions\Comments\EditComment;
use App\Actions\Notifications\NotifyRecipients;
use App\Actions\Projects\AddMember;
use App\Actions\Projects\RemoveMember;
use App\Actions\Users\DeactivateUser;
use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\RemapStates;
use App\Actions\WorkItems\SetSubscription;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Notifications\NotificationKind;
use App\Domain\Properties\FieldType;
use App\Domain\Ranking\Rank;
use App\Events\EventType;
use App\Events\Outbox;
use App\Jobs\SendNotificationMailJob;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\NotificationPreference;
use App\Models\Project;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Notifications\NotificationConsumer;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;

/*
 * Who hears of what (Task 5): the consumer `notifications` turns the events of the real actions into rows of
 * `notifications`. WEB (public) with Tom as its admin and lead, Mara, Ida and Jonas as members and the bot Kira; OPS is
 * private with Tom as its lead and Ida and Ole as members. Mail is off (no mail server, K9) unless a test sets one
 * up ($mailServer).
 */

beforeEach(fn () => consumers(NotificationConsumer::class));

$world = function (): array {
    $tom = User::factory()->create(['name' => 'Tom', 'handle' => 'tom']);
    $web = Project::factory()->identifier('WEB')->public()->member($tom, ProjectRole::Admin)->create(['lead_id' => $tom->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($tom, ProjectRole::Admin)->create(['lead_id' => $tom->id]);
    $mara = memberOf($web, ProjectRole::Member, ['name' => 'Mara', 'handle' => 'mara']);
    $ida = memberOf($web, ProjectRole::Member, ['name' => 'Ida', 'handle' => 'ida']);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas', 'handle' => 'jonas']);
    $kira = User::factory()->bot($tom)->create(['name' => 'Kira', 'handle' => 'kira']);
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);
    app(RoleAssignments::class)->setProjectRole($ida, $ops, ProjectRole::Member);
    $ole = memberOf($ops, ProjectRole::Member, ['name' => 'Ole', 'handle' => 'ole']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $tom->id, 'title' => 'Kontaktformular']);

    return compact('tom', 'web', 'ops', 'mara', 'ida', 'jonas', 'kira', 'ole', 'item');
};

/** The notifications of the account, oldest first. */
$of = fn (User $user) => Notification::query()->where('user_id', $user->id)->orderBy('created_at')->orderBy('id')->get();

/** The kinds the account got, oldest first. */
$kinds = fn (User $user) => $of($user)->map(fn (Notification $n) => $n->kind->value)->all();

/** Stores the choices of the person, `[kind, channel, enabled]` each. */
$choose = function (User $user, array ...$choices): void {
    foreach ($choices as [$kind, $channel, $enabled]) {
        NotificationPreference::query()->create(['user_id' => $user->id, 'kind' => $kind, 'channel' => $channel, 'enabled' => $enabled]);
    }
};

$watch = fn (User $user, WorkItem $item) => SetSubscription::run(actor($user), $item, true);

/**
 * A mail server (K2): mail counts as on, nothing leaves (Mail::fake), and the mail jobs wait instead of running at once
 * (the sync queue knows no delay).
 */
$mailServer = function (): void {
    config(['mail.default' => 'smtp']);
    Mail::fake();
    Queue::fake([SendNotificationMailJob::class]);
};

/** The collections of the account, by scope. */
$mails = fn (User $user) => NotificationMail::query()->where('user_id', $user->id)->get()->keyBy('scope');

it('notifies Mara when Ida comments on an item Mara watches', function () use ($world, $of, $watch) {
    $w = $world();
    $watch($w['mara'], $w['item']);

    $comment = AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);

    $event = eventsOf(EventType::CommentCreated, $w['item'])->sole();
    $mara = $of($w['mara'])->sole();
    expect($mara->kind)->toBe(NotificationKind::Comment)
        ->and($mara->event_id)->toBe($event->id)
        ->and($mara->project_id)->toBe($w['web']->id)
        ->and($mara->work_item_id)->toBe($w['item']->id)
        ->and($mara->actor_id)->toBe($w['ida']->id)
        ->and($mara->data)->toBe(['comment_id' => $comment->id])
        ->and($mara->inbox)->toBeTrue()
        ->and($mara->mail_id)->toBeNull()
        ->and($mara->read_at)->toBeNull()
        ->and($mara->dedupe_key)->toBe("event:{$event->id}")
        // the moment of the event, to the microsecond (P2)
        ->and($mara->created_at?->format('Y-m-d H:i:s.u'))->toBe($event->occurred_at->format('Y-m-d H:i:s.u'))
        // the lead hears of it as well, the writer does not
        ->and($of($w['tom'])->sole()->kind)->toBe(NotificationKind::Comment)
        ->and($of($w['ida']))->toBeEmpty();
});

it('notifies Mara mentioned in a comment once, as mentioned', function () use ($world, $of) {
    $w = $world();

    $comment = AddComment::run(actor($w['ida']), $w['item'], ['body' => '@mara, bitte prüfen.']);
    // still mentioned, but not anew: nothing more
    EditComment::run(actor($w['ida']), $comment, ['body' => '@mara, bitte noch einmal prüfen.']);
    // Jonas is mentioned anew by the edit
    EditComment::run(actor($w['ida']), $comment, ['body' => '@mara und @jonas, bitte noch einmal prüfen.']);

    $mara = $of($w['mara'])->sole();
    expect($mara->kind)->toBe(NotificationKind::Mentioned)
        ->and($mara->data)->toBe(['source' => 'comment', 'comment_id' => $comment->id])
        ->and($mara->event_id)->toBe(eventsOf(EventType::CommentCreated, $w['item'])->sole()->id)
        ->and($of($w['jonas'])->sole()->kind)->toBe(NotificationKind::Mentioned)
        ->and($of($w['jonas'])->sole()->event_id)->toBe(eventsOf(EventType::CommentUpdated, $w['item'])->last()?->id)
        // the lead heard of the comment once, not of the edits
        ->and($of($w['tom'])->map(fn (Notification $n) => $n->kind)->all())->toBe([NotificationKind::Comment]);
});

it('tells where the mention of an item stands: the description or a value', function () use ($world, $of) {
    $w = $world();
    $task = WorkItemType::query()->where('name', 'Task')->firstOrFail();
    $notes = Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]);
    $task->typeProperties()->create(['property_id' => $notes->id, 'required' => false, 'position' => 0]);

    UpdateWorkItem::run(actor($w['ida']), $w['item'], ['description' => 'Frag @jonas.', 'values' => ['notes' => 'Siehe @mara.']]);

    expect($of($w['jonas'])->sole()->data)->toBe(['source' => 'description'])
        ->and($of($w['jonas'])->sole()->kind)->toBe(NotificationKind::Mentioned)
        ->and($of($w['mara'])->sole()->data)->toBe(['source' => 'values']);
});

it('notifies nobody about their own change', function () use ($world, $of) {
    $w = $world();

    UpdateWorkItem::run(actor($w['tom']), $w['item'], ['title' => 'Kontaktformular v2']);
    AddComment::run(actor($w['tom']), $w['item'], ['body' => 'Notiz für @tom.']);
    UpdateWorkItem::run(actor($w['tom']), $w['item'], ['assignee_id' => $w['tom']->id]);

    expect(Notification::query()->count())->toBe(0)
        // the same changes by Ida reach the lead
        ->and(UpdateWorkItem::run(actor($w['ida']), $w['item'], ['title' => 'Kontaktformular v3']))->toBeInstanceOf(WorkItem::class)
        ->and($of($w['tom'])->sole()->kind)->toBe(NotificationKind::ItemChanged);
});

it('never notifies a bot, a deactivated person or one who lost the project', function () use ($world, $of, $watch) {
    $w = $world();
    $admin = User::factory()->admin()->create(['name' => 'Ada']);
    $lene = memberOf($w['web'], ProjectRole::Member, ['name' => 'Lene', 'handle' => 'lene']);
    $watch($lene, $w['item']);
    DeactivateUser::run(actor($admin), $lene);
    $opsItem = WorkItem::factory()->for($w['ops'])->create(['created_by' => $w['tom']->id]);
    $watch($w['ole'], $opsItem);
    RemoveMember::run(actor($w['tom']), $w['ops'], $w['ole']);

    AddComment::run(actor($w['ida']), $w['item'], ['body' => '@kira, bitte übernehmen.']);
    UpdateWorkItem::run(actor($w['ida']), $w['item'], ['assignee_id' => $w['kira']->id]);
    AddComment::run(actor($w['ida']), $opsItem, ['body' => 'Server ist umgezogen.']);

    expect($of($w['kira']))->toBeEmpty()
        ->and($of($lene))->toBeEmpty()
        ->and($of($w['ole']))->toBeEmpty()
        // the lead of both projects hears of all three
        ->and($of($w['tom']))->toHaveCount(3);
});

it('notifies the lead about a new item and the assignee about the assignment', function () use ($world, $of) {
    $w = $world();

    $plain = CreateWorkItem::run(actor($w['ida']), ['project_id' => $w['web']->id, 'title' => 'Impressum']);
    $assigned = CreateWorkItem::run(actor($w['ida']), ['project_id' => $w['web']->id, 'title' => 'Datenschutz', 'assignee_id' => $w['jonas']->id]);

    expect($of($w['tom'])->map(fn (Notification $n) => [$n->kind, $n->work_item_id, $n->data])->all())->toBe([
        [NotificationKind::ItemCreated, $plain->id, []],
        [NotificationKind::ItemCreated, $assigned->id, []],
    ])
        ->and($of($w['jonas'])->sole()->kind)->toBe(NotificationKind::Assigned)
        ->and($of($w['jonas'])->sole()->data)->toBe([])
        ->and($of($w['ida']))->toBeEmpty();
});

it('names the assignee a new item had when it was created, even if it changed hands before the consumer ran', function () use ($world, $kinds) {
    $w = $world();
    consumers();
    $item = CreateWorkItem::run(actor($w['ida']), ['project_id' => $w['web']->id, 'title' => 'Datenschutz', 'assignee_id' => $w['jonas']->id]);
    UpdateWorkItem::run(actor($w['ida']), $item, ['assignee_id' => $w['mara']->id]);
    consumers(NotificationConsumer::class);

    app(Outbox::class)->consume(eventsOf(EventType::WorkItemCreated, $item)->sole()->id, NotificationConsumer::class);
    expect($kinds($w['jonas']))->toBe(['assigned'])
        ->and($kinds($w['mara']))->toBe([]);

    app(Outbox::class)->consume(eventsOf(EventType::WorkItemAssigned, $item)->sole()->id, NotificationConsumer::class);
    expect($kinds($w['mara']))->toBe(['assigned'])
        ->and($kinds($w['jonas']))->toBe(['assigned', 'item_changed']);
});

it('leaves out a person whose inbox and mail are off for the kind, and falls back to the next kind that is on', function () use ($world, $of, $watch, $choose, $mailServer) {
    $mailServer();
    $w = $world();
    $watch($w['jonas'], $w['item']);
    $watch($w['mara'], $w['item']);
    $choose($w['jonas'], ['mentioned', 'inbox', false], ['mentioned', 'mail', false]);
    $choose($w['mara'], ['mentioned', 'inbox', false], ['mentioned', 'mail', false], ['comment', 'inbox', false], ['comment', 'mail', false]);

    AddComment::run(actor($w['ida']), $w['item'], ['body' => '@jonas und @mara, bitte ansehen.']);

    expect($of($w['jonas'])->sole()->kind)->toBe(NotificationKind::Comment)
        ->and($of($w['jonas'])->sole()->inbox)->toBeTrue()
        ->and($of($w['mara']))->toBeEmpty();
});

it('falls back to the inbox kind when no mail server is set', function () use ($world, $of, $watch, $choose) {
    $w = $world();
    $watch($w['jonas'], $w['item']);
    // mail of mentions is on by default, the inbox is off: without a mail server nothing reaches Jonas as mentioned
    $choose($w['jonas'], ['mentioned', 'inbox', false]);

    AddComment::run(actor($w['ida']), $w['item'], ['body' => '@jonas, bitte ansehen.']);

    expect($of($w['jonas'])->sole()->kind)->toBe(NotificationKind::Comment)
        ->and($of($w['jonas'])->sole()->inbox)->toBeTrue();
});

it('stores a mail-only notification hidden from the inbox', function () use ($world, $of, $choose, $mailServer, $mails) {
    $mailServer();
    $w = $world();
    $choose($w['jonas'], ['mentioned', 'inbox', false]);

    AddComment::run(actor($w['ida']), $w['item'], ['body' => '@jonas, bitte ansehen.']);

    expect($of($w['jonas'])->sole()->kind)->toBe(NotificationKind::Mentioned)
        ->and($of($w['jonas'])->sole()->inbox)->toBeFalse()
        ->and($of($w['jonas'])->sole()->mail_id)->toBe($mails($w['jonas'])->sole()->id);
});

it('opens one mail per person and item and joins later ones', function () use ($world, $of, $watch, $mailServer, $mails) {
    $mailServer();
    $this->freezeTime();
    $w = $world();
    $other = WorkItem::factory()->for($w['web'])->create(['created_by' => $w['tom']->id]);
    $watch($w['mara'], $w['item']);
    $watch($w['mara'], $other);
    $watch($w['jonas'], $w['item']);
    // Jonas reads changes in the inbox only: no mail for him
    UpdateWorkItem::run(actor($w['ida']), $w['item'], ['title' => 'Kontaktformular v2']);

    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Erster Hinweis.']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Zweiter Hinweis.']);
    AddComment::run(actor($w['ida']), $other, ['body' => 'Anderes Item.']);

    $mara = $mails($w['mara']);
    $first = $mara["item:{$w['item']->id}"];
    expect($mara)->toHaveCount(2)
        ->and($first->open_key)->toBe("{$w['mara']->id}:item:{$w['item']->id}")
        ->and($first->due_at->toDateTimeString())->toBe(now()->addMinutes(5)->toDateTimeString())
        // its job tries first at due_at: the sweeper counts from there (T7-M2)
        ->and($first->dispatched_at?->toDateTimeString())->toBe(now()->addMinutes(5)->toDateTimeString())
        ->and($first->sent_at)->toBeNull()
        ->and(Notification::query()->where('mail_id', $first->id)->count())->toBe(2)
        ->and(Notification::query()->where('mail_id', $mara["item:{$other->id}"]->id)->count())->toBe(1)
        // the change of the title went to the inbox only
        ->and($of($w['mara'])->first()->kind)->toBe(NotificationKind::ItemChanged)
        ->and($of($w['mara'])->first()->mail_id)->toBeNull()
        // Tom, the lead, has his own; nobody shares one
        ->and($mails($w['tom']))->toHaveCount(2)
        ->and($mails($w['jonas']))->toHaveCount(1);
    // one job per collection, when it is due
    Queue::assertPushed(SendNotificationMailJob::class, 5);
    Queue::assertPushed(SendNotificationMailJob::class, fn (SendNotificationMailJob $job) => $job->mailId === $first->id
        && $job->queue === 'notifications' && $job->delay instanceof DateTimeInterface && $job->delay->getTimestamp() === now()->addMinutes(5)->getTimestamp());
});

it('dispatches the mail job once, after the commit', function () use ($world, $watch) {
    // a real queue (K2): the fake knows no afterCommit; the events wait on it and the test hands them to the consumer
    config(['mail.default' => 'smtp', 'queue.default' => 'database']);
    $this->freezeTime();
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Erster Hinweis.']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Zweiter Hinweis.']);
    [$first, $second] = eventsOf(EventType::CommentCreated, $w['item'])->all();
    $jobs = fn () => DB::table('jobs')->where('queue', 'notifications')->get();
    $consume = fn (string $id) => app(Outbox::class)->consume($id, NotificationConsumer::class);

    // a claim that rolls back opens nothing and leaves no job behind
    try {
        DB::transaction(function () use ($consume, $first) {
            $consume($first->id);
            throw new RuntimeException('rolled back');
        });
    } catch (RuntimeException) {
    }
    expect($jobs())->toHaveCount(0)
        ->and(NotificationMail::query()->count())->toBe(0);

    $consume($first->id);
    $consume($second->id);

    // Mara and Tom one each, waiting until the collection is due
    expect($jobs())->toHaveCount(2)
        ->and($jobs()->pluck('available_at')->unique()->all())->toBe([now()->addMinutes(5)->getTimestamp()])
        ->and(Notification::query()->where('user_id', $w['mara']->id)->whereNotNull('mail_id')->count())->toBe(2);
});

it('opens no mail without a mail server', function () use ($world, $of, $watch) {
    Queue::fake([SendNotificationMailJob::class]);
    $w = $world();
    $watch($w['mara'], $w['item']);

    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);

    expect($of($w['mara'])->sole()->mail_id)->toBeNull()
        ->and(NotificationMail::query()->count())->toBe(0);
    Queue::assertNothingPushed();
});

it('joins a collection that is due but not sent yet', function () use ($world, $of, $watch, $mailServer, $mails) {
    $mailServer();
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Erster Hinweis.']);
    // the job is late: the collection is due for five minutes, still open
    $this->travel(10)->minutes();

    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Zweiter Hinweis.']);

    $mail = $mails($w['mara'])->sole();
    expect($of($w['mara'])->pluck('mail_id')->all())->toBe([$mail->id, $mail->id]);
    Queue::assertPushed(SendNotificationMailJob::class, fn (SendNotificationMailJob $job) => $job->mailId === $mail->id);
    // Mara's and Tom's, once each
    Queue::assertPushed(SendNotificationMailJob::class, 2);
});

it('opens no second mail when an event arrives again after its mail went', function () use ($world, $of, $watch, $mailServer, $mails) {
    $mailServer();
    $w = $world();
    $watch($w['mara'], $w['item']);
    AddComment::run(actor($w['ida']), $w['item'], ['body' => 'Das Formular ist live.']);
    $mail = $mails($w['mara'])->sole();
    $mail->update(['open_key' => null, 'sent_at' => now(), 'outcome' => NotificationMail::SENT]);

    // past the claim of the outbox, as a retry after a failure behind it would: the mail went, none opens anew
    NotifyRecipients::run(actor(User::defaultBot()), eventsOf(EventType::CommentCreated, $w['item'])->sole());

    expect($mails($w['mara']))->toHaveCount(1)
        ->and($of($w['mara'])->sole()->mail_id)->toBe($mail->id);
    Queue::assertPushed(SendNotificationMailJob::class, 2);
});

it('takes the state names of meta.states', function () use ($world, $of) {
    $w = $world();
    $doing = $w['web']->workflow->states()->where('name', 'In Progress')->firstOrFail();

    TransitionWorkItem::run(actor($w['ida']), $w['item'], ['to_state_id' => $doing->id]);
    $doing->update(['name' => 'Läuft']);

    $states = eventsOf(EventType::WorkItemStateChanged, $w['item'])->sole()->meta['states'];
    expect($of($w['tom'])->sole()->kind)->toBe(NotificationKind::StateChanged)
        ->and($of($w['tom'])->sole()->data)->toBe(['from' => $states['old'], 'to' => $states['new']])
        ->and($of($w['tom'])->sole()->data['to']['name'])->toBe('In Progress');
});

it('tells nobody about a state a rebuilt workflow moved (ruling of T3-M4)', function (string $reason) use ($world, $kinds, $watch) {
    $w = $world();
    $watch($w['jonas'], $w['item']);
    $next = $w['web']->workflow->states()->where('id', '!=', $w['item']->state_id)->value('id');

    RemapStates::run(actor($w['ida']), [$w['web']->id], [$w['item']->state_id => $next], $reason);
    expect(eventsOf(EventType::WorkItemStateChanged, $w['item']))->toHaveCount(1)
        ->and(Notification::query()->count())->toBe(0);

    // a move by hand tells the watchers
    TransitionWorkItem::run(actor($w['ida']), $w['item']->refresh(), ['to_state_id' => $w['item']->project->workflow->initial_state_id]);
    expect($kinds($w['jonas']))->toBe(['state_changed'])
        ->and($kinds($w['tom']))->toBe(['state_changed']);
})->with([RemapStates::WORKFLOW_CHANGED, RemapStates::STATE_REMOVED]);

it('takes the fields of the change, not the values', function () use ($world, $of) {
    $w = $world();
    $other = WorkItem::factory()->for($w['web'])->create(['created_by' => $w['tom']->id]);

    UpdateWorkItem::run(actor($w['ida']), $w['item'], ['title' => 'Kontaktformular v2', 'priority' => 'high']);
    // the manual order tells nobody (A270)
    UpdateWorkItem::run(actor($w['ida']), $w['item'], ['rank' => Rank::between($w['item']->rank, null)]);
    AddRelation::run(actor($w['ida']), $w['item'], ['type_id' => RelationType::query()->where('built_in', 'relates')->value('id'), 'target_id' => $other->id]);

    expect($of($w['tom'])->map(fn (Notification $n) => [$n->kind, $n->work_item_id, $n->data])->all())->toBe([
        [NotificationKind::ItemChanged, $w['item']->id, ['fields' => ['title', 'priority']]],
        [NotificationKind::ItemChanged, $w['item']->id, ['fields' => ['relation']]],
        [NotificationKind::ItemChanged, $other->id, ['fields' => ['relation']]],
    ]);
});

it('decides access when it consumes the event, not when the event happened', function () use ($world, $kinds, $watch) {
    $w = $world();
    $opsItem = WorkItem::factory()->for($w['ops'])->create(['created_by' => $w['tom']->id]);
    $watch($w['ole'], $opsItem);
    $lea = memberOf($w['ops'], ProjectRole::Member, ['name' => 'Lea', 'handle' => 'lea']);
    $watch($lea, $opsItem);
    // Lea leaves OPS before the comment and comes back before the consumer runs; Ole leaves in between
    RemoveMember::run(actor($w['tom']), $w['ops'], $lea);
    consumers();
    AddComment::run(actor($w['ida']), $opsItem, ['body' => 'Server ist umgezogen.']);
    RemoveMember::run(actor($w['tom']), $w['ops'], $w['ole']);
    AddMember::run(actor($w['tom']), $w['ops'], ['user_id' => $lea->id, 'role' => 'member']);
    consumers(NotificationConsumer::class);

    app(Outbox::class)->consume(eventsOf(EventType::CommentCreated, $opsItem)->sole()->id, NotificationConsumer::class);

    expect($kinds($w['ole']))->toBe([])
        ->and($kinds($lea))->toBe(['comment'])
        ->and($kinds($w['tom']))->toBe(['comment']);
});

it('asks the same number of queries for two watchers and for ten', function () use ($world, $watch) {
    $w = $world();
    $few = WorkItem::factory()->for($w['web'])->create(['created_by' => $w['tom']->id]);
    $many = WorkItem::factory()->for($w['web'])->create(['created_by' => $w['tom']->id]);
    $people = [$w['mara'], $w['jonas'], ...collect(range(1, 8))->map(fn (int $n) => memberOf($w['web'], ProjectRole::Member, ['name' => "Person {$n}"]))->all()];
    foreach (array_slice($people, 0, 2) as $person) {
        $watch($person, $few);
    }
    foreach ($people as $person) {
        $watch($person, $many);
    }
    consumers();
    AddComment::run(actor($w['ida']), $few, ['body' => 'Erledigt.']);
    AddComment::run(actor($w['ida']), $many, ['body' => 'Erledigt.']);
    consumers(NotificationConsumer::class);
    $queries = function (WorkItem $item): int {
        DB::flushQueryLog();
        app(Outbox::class)->consume(eventsOf(EventType::CommentCreated, $item)->sole()->id, NotificationConsumer::class);

        return count(DB::getQueryLog());
    };

    DB::enableQueryLog();
    $two = $queries($few);
    $ten = $queries($many);
    DB::disableQueryLog();

    // the lead hears of both as well
    expect(Notification::query()->where('work_item_id', $few->id)->count())->toBe(3)
        ->and(Notification::query()->where('work_item_id', $many->id)->count())->toBe(11)
        ->and($ten)->toBe($two);
});
