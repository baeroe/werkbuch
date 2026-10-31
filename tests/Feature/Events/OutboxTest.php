<?php

use App\Events\EventRecorder;
use App\Events\EventType;
use App\Events\Outbox;
use App\Jobs\ConsumeEvent;
use App\Jobs\DispatchEvent;
use App\Models\Event;
use App\Models\EventConsumption;
use App\Models\Project;
use App\Models\User;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Database\QueryException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\Support\FailingOnceConsumer;
use Tests\Support\RecordingConsumer;
use Tests\Support\SearchConsumer;

beforeEach(function () {
    consumers(RecordingConsumer::class);
    RecordingConsumer::$seen = [];
});

/**
 * An event recorded the way an action records it: inside its transaction.
 */
function recordedEvent(): Event
{
    $project = Project::factory()->create();

    return DB::transaction(fn () => EventRecorder::record(EventType::ProjectCreated, actor($project->lead), $project, $project));
}

it('hands the event to its consumers once the transaction commits', function () {
    $event = recordedEvent();

    expect(RecordingConsumer::$seen)->toBe([$event->id])
        ->and($event->fresh()?->dispatched_at)->not->toBeNull();
});

it('runs each consumer once when the event is dispatched twice', function () {
    $event = recordedEvent();
    DispatchEvent::dispatchSync($event->id);
    DispatchEvent::dispatchSync($event->id);        // the redispatcher picked it up while the first was queued

    expect(RecordingConsumer::$seen)->toBe([$event->id])
        ->and(EventConsumption::query()->where('event_id', $event->id)->count())->toBe(1)
        ->and($event->fresh()?->dispatched_at)->not->toBeNull();
});

it('keeps the first dispatch time when the event is dispatched again', function () {
    $this->freezeSecond();
    $event = recordedEvent();
    $first = $event->fresh()?->dispatched_at;

    $this->travel(5)->minutes();
    DispatchEvent::dispatchSync($event->id);

    expect($event->fresh()?->dispatched_at?->equalTo($first))->toBeTrue();
});

it('redispatches an event whose dispatch never ran, after two minutes and only once', function () {
    Queue::fake();                                   // nothing runs: the process died between commit and dispatch
    $event = recordedEvent();

    $this->travel(119)->seconds();
    $this->artisan('app:redispatch-events')->expectsOutput('Redispatched 0 events.');
    $this->travel(2)->seconds();
    $this->artisan('app:redispatch-events')->expectsOutput('Redispatched 1 events.');
    Queue::assertPushed(DispatchEvent::class, 2);

    // the lost original turns up late, next to the redispatch: both run, the consumer runs once
    $outbox = app(Outbox::class);
    Queue::pushed(DispatchEvent::class)->each(fn (DispatchEvent $job) => $job->handle($outbox));
    Queue::pushed(ConsumeEvent::class)->each(fn (ConsumeEvent $job) => $job->handle($outbox));
    $this->artisan('app:redispatch-events')->expectsOutput('Redispatched 0 events.');

    expect(RecordingConsumer::$seen)->toBe([$event->id]);
});

it('redispatches a backlog once per fifteen minutes, not every minute', function () {
    Queue::fake();                                   // the worker is down: nothing gets dispatched
    $this->freezeSecond();
    $start = now()->toImmutable();
    recordedEvent();
    $redispatchAt = function (string $offset, int $count) use ($start) {
        $this->travelTo($start->add($offset));
        $this->artisan('app:redispatch-events')->expectsOutput("Redispatched {$count} events.");
    };

    $redispatchAt('3 minutes', 1);
    $redispatchAt('4 minutes', 0);
    $redispatchAt('10 minutes', 0);
    $redispatchAt('18 minutes', 0);                  // exactly fifteen minutes after the last redispatch
    $redispatchAt('18 minutes 1 second', 1);
    $redispatchAt('20 minutes', 0);

    Queue::assertPushed(DispatchEvent::class, 3);   // the original and two redispatches
});

it('redispatches at most 500 events per run', function () {
    Queue::fake();
    $user = User::factory()->create();
    $occurred = now()->subMinutes(5)->format('Y-m-d H:i:s.u');
    Event::query()->insert(array_map(fn () => [
        'id' => (string) Str::ulid(),
        'type' => EventType::UserUpdated->value,
        'actor_id' => $user->id,
        'subject_type' => 'user',
        'subject_id' => $user->id,
        'meta' => '{"via":"ui","reason":null}',
        'occurred_at' => $occurred,
    ], range(1, 501)));

    $this->artisan('app:redispatch-events')->expectsOutput('Redispatched 500 events.');
    $this->artisan('app:redispatch-events')->expectsOutput('Redispatched 1 events.');
    $this->artisan('app:redispatch-events')->expectsOutput('Redispatched 0 events.');
});

it('reports an event that is still not dispatched after an hour', function () {
    Queue::fake();
    Exceptions::fake();
    $this->freezeSecond();
    $start = now()->toImmutable();
    $event = recordedEvent();

    $this->travelTo($start->addMinutes(59));
    $this->artisan('app:redispatch-events')->expectsOutput('Redispatched 1 events.');
    Exceptions::assertNothingReported();

    $this->travelTo($start->addMinutes(75));
    $this->artisan('app:redispatch-events')->expectsOutput('Redispatched 1 events.');
    Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === "Event {$event->id} is still not dispatched after 60 minutes.");
});

it('fails loudly when a consumer claims an event that does not exist', function () {
    expect(fn () => app(Outbox::class)->consume(strtolower((string) Str::ulid()), RecordingConsumer::class))
        ->toThrow(function (QueryException $e) {
            expect($e)->not->toBeInstanceOf(UniqueConstraintViolationException::class);
        })
        ->and(RecordingConsumer::$seen)->toBe([]);
});

it('leaves neither event nor dispatch when the transaction rolls back', function () {
    // the dispatch itself runs for real (the fake ignores afterCommit); a dispatch that ran would push a ConsumeEvent
    Queue::fake([ConsumeEvent::class]);
    $project = Project::factory()->create();

    expect(fn () => DB::transaction(function () use ($project) {
        EventRecorder::record(EventType::ProjectCreated, actor($project->lead), $project, $project);

        throw new RuntimeException('The action fails after recording.');
    }))->toThrow(RuntimeException::class, 'The action fails after recording.');

    expect(Event::query()->where('subject_id', $project->id)->count())->toBe(0) // the default bot of the migration has one
        ->and(RecordingConsumer::$seen)->toBe([]);
    Queue::assertNothingPushed();
});

it('runs a consumer again after it failed', function () {
    consumers(FailingOnceConsumer::class);
    FailingOnceConsumer::$attempts = 0;
    FailingOnceConsumer::$seen = [];
    Queue::fake();
    $event = recordedEvent();
    $outbox = app(Outbox::class);
    $outbox->dispatch($event->id);
    $job = Queue::pushed(ConsumeEvent::class)->sole();

    expect(fn () => $job->handle($outbox))->toThrow(RuntimeException::class, 'The first attempt fails.')
        ->and(EventConsumption::query()->count())->toBe(0);

    $job->handle($outbox);
    $job->handle($outbox);

    expect(FailingOnceConsumer::$seen)->toBe([$event->id])
        ->and(FailingOnceConsumer::$attempts)->toBe(2)
        ->and(EventConsumption::query()->sole()->consumer)->toBe('failing_once');
});

it('keeps consumers apart: each one gets the event once', function () {
    consumers(RecordingConsumer::class, FailingOnceConsumer::class);
    FailingOnceConsumer::$attempts = 1;              // past its failing attempt
    FailingOnceConsumer::$seen = [];
    $event = recordedEvent();

    expect(RecordingConsumer::$seen)->toBe([$event->id])
        ->and(FailingOnceConsumer::$seen)->toBe([$event->id])
        ->and(EventConsumption::query()->orderBy('consumer')->pluck('consumer')->all())->toBe(['failing_once', 'recording']);
});

it('puts each consumer in its own queue', function () {
    consumers(RecordingConsumer::class, SearchConsumer::class);
    Queue::fake();
    $event = recordedEvent();

    app(Outbox::class)->dispatch($event->id);

    Queue::assertPushedOn('default', DispatchEvent::class);
    Queue::assertPushedOn('default', ConsumeEvent::class, fn (ConsumeEvent $job) => $job->consumer === RecordingConsumer::class);
    Queue::assertPushedOn('search', ConsumeEvent::class, fn (ConsumeEvent $job) => $job->consumer === SearchConsumer::class
        && $job->eventId === $event->id);
});

it('retries both jobs with a growing pause', function () {
    foreach ([new DispatchEvent('x'), new ConsumeEvent('x', RecordingConsumer::class)] as $job) {
        expect($job->tries)->toBe(5)->and($job->backoff)->toBe([10, 60, 300]);
    }
});

it('schedules the redispatcher every minute', function () {
    $task = collect(app(Schedule::class)->events())->sole(fn ($event) => str_contains((string) $event->command, 'app:redispatch-events'));

    expect($task->expression)->toBe('* * * * *')
        ->and($task->withoutOverlapping)->toBeTrue()
        ->and($task->expiresAt)->toBe(5);           // a crashed run frees the lock after 5 minutes, not 24 hours
});
