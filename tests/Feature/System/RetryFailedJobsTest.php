<?php

use App\Actions\System\RetryFailedJobs;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/*
 * "Erneut versuchen" on the system page (Task 11, A287): failed jobs go back into their queue with their attempts
 * reset, as `queue:retry` puts them, and leave `failed_jobs`; one event `system.failed_jobs_retried` names them.
 */

$failed = function (string $queue): string {
    DB::table('failed_jobs')->insert([
        'uuid' => $uuid = (string) Str::uuid(), 'connection' => 'database', 'queue' => $queue,
        'payload' => json_encode(['uuid' => $uuid, 'displayName' => 'App\\Jobs\\Example', 'attempts' => 5, 'data' => ['command' => 'x']]),
        'exception' => 'RuntimeException: boom', 'failed_at' => now()->utc(),
    ]);

    return $uuid;
};

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
});

it('puts all failed jobs back and records one event', function () use ($failed) {
    $mail = $failed('notifications');
    $hook = $failed('webhooks');

    expect(RetryFailedJobs::run(actor($this->admin), []))->toBe(2)
        ->and(DB::table('failed_jobs')->count())->toBe(0);

    $jobs = DB::table('jobs')->orderBy('id')->get();
    expect($jobs->pluck('queue')->all())->toBe(['notifications', 'webhooks'])
        ->and($jobs->map(fn (object $job) => json_decode($job->payload, true))->all())->toBe([
            ['uuid' => $mail, 'displayName' => 'App\\Jobs\\Example', 'attempts' => 0, 'data' => ['command' => 'x']],
            ['uuid' => $hook, 'displayName' => 'App\\Jobs\\Example', 'attempts' => 0, 'data' => ['command' => 'x']],
        ]);

    $event = eventsOf(EventType::SystemFailedJobsRetried)->sole();
    expect($event->actor_id)->toBe($this->admin->id)
        ->and($event->subject_type)->toBe('organization')
        ->and($event->subject_id)->toBe(Organization::current()->id)
        ->and($event->project_id)->toBeNull()
        ->and($event->changes)->toBeNull()
        ->and($event->meta)->toMatchArray(['count' => 2, 'ids' => [$mail, $hook]]);
});

it('puts all of many back in blocks of 500, each with its own event (T11-M1)', function () {
    $now = now()->utc();
    DB::table('failed_jobs')->insert(array_map(fn (int $n) => [
        'uuid' => (string) Str::uuid(), 'connection' => 'database', 'queue' => 'notifications',
        'payload' => json_encode(['displayName' => 'App\\Jobs\\Example', 'attempts' => 5]), 'exception' => 'RuntimeException: boom', 'failed_at' => $now,
    ], range(1, RetryFailedJobs::BLOCK + 1)));

    expect(RetryFailedJobs::run(actor($this->admin), []))->toBe(RetryFailedJobs::BLOCK + 1)
        ->and(DB::table('failed_jobs')->count())->toBe(0)
        ->and(DB::table('jobs')->count())->toBe(RetryFailedJobs::BLOCK + 1);

    $events = eventsOf(EventType::SystemFailedJobsRetried);
    expect($events->map(fn ($event) => $event->meta['count'])->all())->toBe([RetryFailedJobs::BLOCK, 1])
        ->and(count($events[0]->meta['ids']))->toBe(RetryFailedJobs::BLOCK);
});

it('puts back only the named ones', function () use ($failed) {
    $first = $failed('notifications');
    $second = $failed('default');
    $third = $failed('search');

    expect(RetryFailedJobs::run(actor($this->admin), ['ids' => [strtoupper($third), $first, (string) Str::uuid()]]))->toBe(2)
        ->and(DB::table('failed_jobs')->pluck('uuid')->all())->toBe([$second])
        ->and(DB::table('jobs')->pluck('queue')->sort()->values()->all())->toBe(['notifications', 'search'])
        ->and(eventsOf(EventType::SystemFailedJobsRetried)->sole()->meta)->toMatchArray(['count' => 2, 'ids' => [$first, $third]]);
});

it('leaves a payload without attempts as it was', function () {
    DB::table('failed_jobs')->insert(['uuid' => (string) Str::uuid(), 'connection' => 'database', 'queue' => 'default',
        'payload' => '{"job":"x"}', 'exception' => 'x', 'failed_at' => now()->utc()]);

    expect(RetryFailedJobs::run(actor($this->admin), []))->toBe(1)
        ->and(DB::table('jobs')->sole()->payload)->toBe('{"job":"x"}');
});

it('records nothing when there is nothing to put back', function () {
    expect(RetryFailedJobs::run(actor($this->admin), ['ids' => [(string) Str::uuid()]]))->toBe(0)
        ->and(RetryFailedJobs::run(actor($this->admin), ['ids' => null]))->toBe(0)
        ->and(eventsOf(EventType::SystemFailedJobsRetried))->toHaveCount(0);
});

it('takes ids as a list of 1 to 100 UUIDs', function (mixed $ids) use ($failed) {
    $failed('default');

    try {
        RetryFailedJobs::run(actor($this->admin), ['ids' => $ids]);
        $this->fail('no 422');
    } catch (ValidationException $e) {
        expect($e->errors())->toBe(['ids' => [__('field.ids.failed_jobs', ['max' => 100])]]);
    }

    expect(DB::table('failed_jobs')->count())->toBe(1);
})->with([
    'no list' => ['abc'],
    'empty' => [[]],
    'not a UUID' => [['01jc0000000000000000000000']],
    'not a string' => [[42]],
    'a map' => [['a' => (string) Str::uuid()]],
    'too many' => [array_map(fn () => (string) Str::uuid(), range(1, 101))],
]);

it('refuses members and bots with 403', function () use ($failed) {
    $failed('default');

    foreach ([User::factory()->create(), User::defaultBot()] as $account) {
        expect(fn () => RetryFailedJobs::run(actor($account), []))->toThrow(Problem::class, __('problem.detail.system_admins_only'));
    }

    expect(DB::table('failed_jobs')->count())->toBe(1);
});
