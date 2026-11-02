<?php

use App\Events\ConsumerGaveUp;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Events\Outbox;
use App\Jobs\ConsumeEvent;
use App\Models\Project;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Tests\Support\PatientConsumer;
use Tests\Support\RecordingConsumer;

/**
 * The payload of the job the outbox pushed for the consumer's queue.
 *
 * @return array<string, mixed>
 */
$pushed = function (string $consumer, string $queue): array {
    config(['queue.default' => 'database']);
    consumers($consumer);
    $project = Project::factory()->create();
    $event = DB::transaction(fn () => EventRecorder::record(EventType::ProjectCreated, actor($project->lead), $project, $project));

    app(Outbox::class)->dispatch($event->id);

    $row = DB::table('jobs')->where('queue', $queue)->get()
        ->first(fn ($job) => str_contains((string) $job->payload, 'ConsumeEvent'));

    return json_decode((string) $row?->payload, true);
};

it('puts the tries and the backoff of the consumer into the payload', function () use ($pushed) {
    $payload = $pushed(PatientConsumer::class, 'search');

    expect($payload['maxTries'])->toBe(8)
        ->and($payload['backoff'])->toBe('10,60,300,900,3600');
});

it('keeps five tries for a consumer without its own', function () use ($pushed) {
    $payload = $pushed(RecordingConsumer::class, 'default');

    expect($payload['maxTries'])->toBe(5)
        ->and($payload['backoff'])->toBe('10,60,300');
});

it('reports which consumer gave up on which event', function () {
    Exceptions::fake();

    (new ConsumeEvent('01jbz00000000000000000000', RecordingConsumer::class))->failed(new RuntimeException('down'));

    Exceptions::assertReported(fn (ConsumerGaveUp $e) => $e->eventId === '01jbz00000000000000000000'
        && $e->consumer === RecordingConsumer::class
        && $e->getPrevious()?->getMessage() === 'down');
});
