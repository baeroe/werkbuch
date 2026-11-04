<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Comments\AddComment;
use App\Actions\Notifications\NotifyRecipients;
use App\Actions\Pages\CreatePage;
use App\Actions\Pages\DeletePage;
use App\Actions\Pages\MovePage;
use App\Actions\Pages\UpdatePage;
use App\Actions\Projects\DeleteProject;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Events\EventType;
use App\Events\Outbox;
use App\Jobs\ConsumeEvent;
use App\Jobs\PurgeProject;
use App\Live\LiveConsumer;
use App\Models\Event;
use App\Models\EventConsumption;
use App\Models\Notification;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Notifications\NotificationConsumer;
use App\RichText\Document;
use App\Search\SearchConsumer;
use App\Support\Actor;
use App\Support\NotificationFacts;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Support\RichTextFixtures as F;

/*
 * The consumer `notifications` (Task 5): its queue and tries, and that it writes once whatever the outbox does twice.
 * The consumers stay off while a test writes its events; it hands them on itself (Outbox::consume).
 */

/** WEB with Tom as its lead and Ida as a member, and an item of it; a comment of Ida tells Tom. */
$world = function (): array {
    $tom = User::factory()->create(['name' => 'Tom', 'handle' => 'tom']);
    $web = Project::factory()->identifier('WEB')->member($tom, ProjectRole::Admin)->create(['lead_id' => $tom->id]);
    $ida = memberOf($web, ProjectRole::Member, ['name' => 'Ida', 'handle' => 'ida']);
    $item = WorkItem::factory()->for($web)->create(['created_by' => $tom->id]);

    return compact('tom', 'web', 'ida', 'item');
};

$comment = function (array $w, string $body = 'Das Formular ist live.'): Event {
    AddComment::run(actor($w['ida']), $w['item'], ['body' => $body]);

    return eventsOf(EventType::CommentCreated, $w['item'])->last() ?? throw new RuntimeException('No comment event.');
};

$consume = fn (Event $event): bool => app(Outbox::class)->consume($event->id, NotificationConsumer::class);

it('is a consumer of every event, in the queue notifications, with the tries of the search', function () {
    $consumer = new NotificationConsumer;

    expect(config('werkbuch.event_consumers'))->toBe([])        // off in tests until a test switches it on (K2)
        ->and(require repo_path('config/werkbuch.php'))->toHaveKey('event_consumers', [SearchConsumer::class, NotificationConsumer::class, LiveConsumer::class])
        ->and($consumer->key())->toBe('notifications')
        ->and($consumer->queue())->toBe('notifications')
        ->and($consumer->tries())->toBe(8)
        ->and($consumer->backoff())->toBe([10, 60, 300, 900, 3600]);
});

it('puts its job in the queue notifications', function () use ($world, $comment) {
    $w = $world();
    $event = $comment($w);
    consumers(NotificationConsumer::class);
    Queue::fake();

    app(Outbox::class)->dispatch($event->id);

    Queue::assertPushedOn('notifications', ConsumeEvent::class, fn (ConsumeEvent $job) => $job->consumer === NotificationConsumer::class
        && $job->eventId === $event->id);
});

it('writes one notification for an event that arrives twice', function () use ($world, $comment, $consume) {
    $w = $world();
    $first = $comment($w);

    expect($consume($first))->toBeTrue()
        ->and($consume($first))->toBeFalse()
        ->and(Notification::query()->where('event_id', $first->id)->count())->toBe(1);

    // a retry after the work failed behind the claim: the rollback took claim and rows, the retry writes once
    $second = $comment($w, 'Und der Footer auch.');
    expect(fn () => DB::transaction(function () use ($consume, $second) {
        $consume($second);

        throw new RuntimeException('The job dies after the work.');
    }))->toThrow(RuntimeException::class, 'The job dies after the work.')
        ->and(Notification::query()->where('event_id', $second->id)->count())->toBe(0)
        ->and($consume($second))->toBeTrue()
        ->and(Notification::query()->where('event_id', $second->id)->count())->toBe(1);

    // without the claim (queue:retry of a job that lost it), the unique key of the row still holds
    EventConsumption::query()->where('event_id', $first->id)->delete();
    expect($consume($first))->toBeTrue()
        ->and(NotifyRecipients::run(Actor::system(User::defaultBot(), 'test'), $first))->toBe(0)
        ->and(Notification::query()->where('event_id', $first->id)->count())->toBe(1);
});

it('takes the events of the migrations without notifications', function () use ($consume) {
    $events = Event::query()->get();

    expect($events->pluck('type')->map(fn (EventType $type) => $type->value)->all())->toContain('bot.created', 'workflow.created')
        ->and($events->map(fn (Event $event) => $consume($event))->unique()->all())->toBe([true])
        ->and(Notification::query()->count())->toBe(0);
});

it('passes an event of a project being deleted', function () use ($world, $comment, $consume) {
    $w = $world();
    $event = $comment($w);
    Queue::fake([PurgeProject::class]);
    DeleteProject::run(actor($w['tom']), $w['web']);

    expect($consume($event))->toBeTrue()
        ->and($consume(eventsOf(EventType::ProjectDeleted)->sole()))->toBeTrue()
        ->and(Notification::query()->count())->toBe(0);
});

it('passes an event whose item is gone', function () use ($world, $comment, $consume) {
    $w = $world();
    $event = $comment($w);
    DeleteWorkItem::run(actor($w['tom']), $w['item']);

    expect($consume($event))->toBeTrue()
        ->and($consume(eventsOf(EventType::WorkItemDeleted)->sole()))->toBeTrue()
        ->and(Notification::query()->count())->toBe(0);
});

it('notifies nobody about a page, also not a person mentioned in it (A313)', function () use ($world, $consume) {
    $w = $world();
    $kira = User::factory()->bot($w['tom'])->create(['name' => 'Kira', 'handle' => 'kira']);
    app(RoleAssignments::class)->setProjectRole($kira, $w['web'], ProjectRole::Member);
    $other = Page::factory()->create(['project_id' => $w['web']->id]);

    $page = CreatePage::run(actor($w['ida']), $w['web'], ['title' => 'Ablauf', 'content_json' => F::doc(F::p(F::mention($w['tom']->id, 'tom'), ' bitte prüfen'))]);
    $page = UpdatePage::run(actor($w['ida']), $page, ['content_json' => F::doc(F::p(F::mention($w['tom']->id, 'tom'), ' und ', F::mention($kira->id, 'kira'), ' bitte prüfen'))]);
    MovePage::run(actor($w['ida']), $page, ['parent_id' => $other->id, 'before_id' => null]);
    DeletePage::run(actor($w['ida']), $other);

    $events = Event::query()->where('type', 'like', 'page.%')->get();
    expect(Document::fromJson((array) $page->content)->mentionedUserIds())->toEqualCanonicalizing([$w['tom']->id, $kira->id])
        ->and($events)->toHaveCount(4)
        ->and($events->map(fn (Event $event) => NotificationFacts::of($event))->filter()->all())->toBe([])
        ->and($events->map(fn (Event $event) => $consume($event))->unique()->all())->toBe([true])
        ->and(Notification::query()->count())->toBe(0)
        // a mentioned bot hears of it nowhere either
        ->and(eventsOf(EventType::BotMentioned))->toHaveCount(0);
});
