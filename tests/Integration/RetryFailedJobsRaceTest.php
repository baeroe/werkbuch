<?php

use App\Actions\System\RetryFailedJobs;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\RaceConnections;

/*
 * Two org admins press "Erneut versuchen" at the same time (Task 11): RetryFailedJobs reads the failed jobs under a lock,
 * so the second one waits for the first and then finds nothing left, instead of putting the same jobs back twice.
 * `mariadb` holds its transaction open like a request in progress, `mariadb_second` is the other request; the failed
 * jobs live on the connection of `queue.failed.database`, so the second request points it at its own connection.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(function () {
    RaceConnections::tearDown();
    app()->forgetInstance('queue.failer');
});

it('makes a second retry wait for the first', function () {
    $admin = User::factory()->admin()->create();
    DB::table('failed_jobs')->insert(['uuid' => (string) Str::uuid(), 'connection' => 'database', 'queue' => 'default',
        'payload' => '{"attempts":3}', 'exception' => 'RuntimeException: boom', 'failed_at' => now()->utc()]);

    expect(RaceConnections::hold(fn () => RetryFailedJobs::run(actor($admin), [])))->toBe(1);

    $failedOn = config('queue.failed.database');
    RaceConnections::expectLockWait(RaceConnections::second(function () use ($admin) {
        config(['queue.failed.database' => 'mariadb_second']);
        app()->forgetInstance('queue.failer');

        return RetryFailedJobs::run(actor($admin), []);
    }), 'failed_jobs', 'select `uuid`, `connection`, `queue`, `payload` from `failed_jobs`');
    config(['queue.failed.database' => $failedOn]);

    RaceConnections::release();

    expect(DB::table('jobs')->count())->toBe(1)->and(DB::table('failed_jobs')->count())->toBe(0);
});
