<?php

use App\Actions\System\GetSystemStatus;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/*
 * What the system page shows its org admins (Task 11, A287): the version, the backlog per queue (only jobs that are due
 * and not being worked, delayed ones such as mail collections apart), the newest failed jobs, Meilisearch, mail and
 * Reverb. The jobs are rows of `jobs` and `failed_jobs` as the database queue writes them.
 */

$job = function (string $queue, int $availableAt, ?int $reservedAt = null): void {
    DB::table('jobs')->insert([
        'queue' => $queue, 'payload' => '{}', 'attempts' => 0, 'reserved_at' => $reservedAt,
        'available_at' => $availableAt, 'created_at' => $availableAt,
    ]);
};

$failed = function (string $queue, string $job, string $exception, string $failedAt): string {
    DB::table('failed_jobs')->insert([
        'uuid' => $uuid = (string) Str::uuid(), 'connection' => 'database', 'queue' => $queue,
        'payload' => json_encode(['uuid' => $uuid, 'displayName' => $job, 'attempts' => 3]),
        'exception' => $exception, 'failed_at' => $failedAt,
    ]);

    return $uuid;
};

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
    $this->travelTo(now()->parse('2026-11-03 10:00:00', 'UTC'));
});

it('shows version, backlog per queue and delayed jobs apart', function () use ($job) {
    $now = now()->getTimestamp();
    $job('notifications', $now - 600);
    $job('notifications', $now - 60);
    $job('notifications', $now);
    $job('default', $now - 30);
    $job('default', $now - 900, reservedAt: $now - 5);   // being worked: no backlog
    $job('notifications', $now + 300);                     // a mail collection due in 5 minutes (A287)
    $job('search', $now + 1);

    $status = GetSystemStatus::run(actor($this->admin));

    expect($status['version'])->toBe(config('werkbuch.version'))
        ->and($status['queued_jobs'])->toBe(4)
        ->and($status['delayed_jobs'])->toBe(2)
        ->and(array_column($status['queues'], 'queue'))->toBe(config('werkbuch.queues'))
        ->and(collect($status['queues'])->keyBy('queue')->map(fn (array $q) => [$q['pending'], $q['oldest_at']?->toJSON()])->all())->toBe([
            'default' => [1, '2026-11-03T09:59:30.000000Z'],
            'live' => [0, null],
            'notifications' => [3, '2026-11-03T09:50:00.000000Z'],
            'webhooks' => [0, null],
            'search' => [0, null],
            'media' => [0, null],
            'bulk' => [0, null],
        ]);
});

it('lists the newest failed jobs with the first line of the error only', function () use ($failed) {
    foreach (range(1, 51) as $n) {
        $failed('webhooks', 'App\\Jobs\\Old', "old {$n}", sprintf('2026-10-01 %02d:%02d:00', intdiv($n, 60), $n % 60));
    }
    $newest = $failed('notifications', 'App\\Jobs\\SendNotificationMailJob',
        "Symfony\\Component\\Mailer\\Exception\\TransportException: Connection refused\n#0 /var/www/html/vendor/…\n#1 {main}",
        '2026-11-02 08:15:00');
    $long = $failed('search', 'App\\Events\\ConsumeEvent', str_repeat('x', 400)."\nnext", '2026-11-01 12:00:00');

    $status = GetSystemStatus::run(actor($this->admin));
    $jobs = $status['failed_jobs'];

    expect($status['failed_jobs_total'])->toBe(53)
        ->and($jobs)->toHaveCount(50)
        ->and($jobs[0])->toMatchArray(['id' => $newest, 'queue' => 'notifications', 'job' => 'App\\Jobs\\SendNotificationMailJob',
            'error' => 'Symfony\\Component\\Mailer\\Exception\\TransportException: Connection refused'])
        ->and($jobs[0]['failed_at']->toJSON())->toBe('2026-11-02T08:15:00.000000Z')
        ->and($jobs[1]['id'])->toBe($long)
        ->and($jobs[1]['error'])->toBe(str_repeat('x', 300))
        // the three oldest of the 51 old ones fall off the list
        ->and(array_column($jobs, 'error'))->not->toContain('old 1', 'old 2', 'old 3')->toContain('old 4', 'old 51');
});

it('names no job for a payload it cannot read', function () {
    DB::table('failed_jobs')->insert(['uuid' => $uuid = (string) Str::uuid(), 'connection' => 'database', 'queue' => 'default',
        'payload' => 'not json', 'exception' => '', 'failed_at' => '2026-11-02 08:15:00']);

    expect(GetSystemStatus::run(actor($this->admin))['failed_jobs'][0])->toMatchArray(['id' => $uuid, 'job' => '', 'error' => '']);
});

it('says search is down when Meilisearch does not answer', function () {
    // the engine of the tests is `null`, which knows nothing about Meilisearch
    expect(GetSystemStatus::run(actor($this->admin)))->toMatchArray(['search' => 'down', 'search_tasks' => null]);

    $engine = searchEngine();
    expect(GetSystemStatus::run(actor($this->admin)))->toMatchArray([
        'search' => 'ok', 'search_tasks' => ['enqueued' => 0, 'processing' => 0, 'failed_last_day' => 0],
    ]);

    $engine->failWith(new RuntimeException('Meilisearch is gone'));
    expect(GetSystemStatus::run(actor($this->admin)))->toMatchArray(['search' => 'down', 'search_tasks' => null]);
});

it('says whether mail is configured', function () {
    expect(GetSystemStatus::run(actor($this->admin))['mail_configured'])->toBeFalse();

    config(['mail.default' => 'smtp']);
    expect(GetSystemStatus::run(actor($this->admin))['mail_configured'])->toBeTrue();
});

it('says live is off for the log broadcaster', function () {
    Http::preventStrayRequests();
    config(['broadcasting.default' => 'log']);

    expect(GetSystemStatus::run(actor($this->admin))['live'])->toBe('off');
    Http::assertNothingSent();
});

it('asks Reverb whether it is up', function () {
    Http::preventStrayRequests();
    liveChannels();
    Http::fakeSequence('http://127.0.0.1:6001/up')
        ->push('{"health":"OK"}')
        ->push('', 500)
        ->pushFailedConnection('Connection refused');

    expect(GetSystemStatus::run(actor($this->admin))['live'])->toBe('ok')
        ->and(GetSystemStatus::run(actor($this->admin))['live'])->toBe('down')
        ->and(GetSystemStatus::run(actor($this->admin))['live'])->toBe('down');

    Http::assertSentCount(3);
    Http::assertSent(fn ($request) => $request->url() === 'http://127.0.0.1:6001/up' && $request->method() === 'GET');
});

it('refuses members and bots with 403', function () {
    foreach ([User::factory()->create(), User::defaultBot(), User::factory()->bot()->create()] as $account) {
        expect(refusal($account, 'viewSystem', Organization::class))
            ->status->toBe(403)
            ->detail->toBe(__('problem.detail.system_admins_only'));
    }

    expect(fn () => GetSystemStatus::run(actor(User::defaultBot())))->toThrow(Problem::class);
});
