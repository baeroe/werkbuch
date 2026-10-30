<?php

use App\Events\EventRecorder;
use App\Events\EventType;
use App\Events\Outbox;
use App\Jobs\ConsumeEvent;
use App\Jobs\DispatchEvent;
use App\Models\Event;
use App\Models\EventConsumption;
use App\Models\Project;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
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

it('leaves neither event nor dispatch when the transaction rolls back', function () {
    // the dispatch itself runs for real (the fake ignores afterCommit); a dispatch that ran would push a ConsumeEvent
    Queue::fake([ConsumeEvent::class]);
    $project = Project::factory()->create();

    expect(fn () => DB::transaction(function () use ($project) {
        EventRecorder::record(EventType::ProjectCreated, actor($project->lead), $project, $project);

        throw new RuntimeException('The action fails after recording.');
    }))->toThrow(RuntimeException::class, 'The action fails after recording.');

    expect(Event::query()->count())->toBe(0)
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
        ->and($task->withoutOverlapping)->toBeTrue();
});
