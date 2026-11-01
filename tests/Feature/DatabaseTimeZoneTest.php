<?php

use App\Models\Organization;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

it('runs the database session in UTC, also on a copy of the connection', function () {
    // tests/Support/RaceConnections copies the connection as `mariadb_second`
    config(['database.connections.mariadb_copy' => config('database.connections.mariadb')]);

    expect(DB::connection('mariadb')->scalar('select @@session.time_zone'))->toBe('+00:00')
        ->and(DB::connection('mariadb_copy')->scalar('select @@session.time_zone'))->toBe('+00:00');

    DB::purge('mariadb_copy');
});

it('keeps a UTC timestamp in the hour the clocks skip in Europe', function () {
    // 02:30 UTC on 2026-03-29 is 04:30 in Berlin; read as Berlin wall clock it would not exist (error 1292)
    $organization = Organization::current();
    $organization->forceFill(['updated_at' => Carbon::parse('2026-03-29 02:30:00', 'UTC')])->save();

    expect(DB::table('organization')->value('updated_at'))->toBe('2026-03-29 02:30:00')
        ->and((int) DB::table('organization')->value(DB::raw('unix_timestamp(updated_at)')))->toBe(Carbon::parse('2026-03-29 02:30:00', 'UTC')->getTimestamp())
        ->and($organization->fresh()?->updated_at?->toIso8601String())->toBe('2026-03-29T02:30:00+00:00');
});
