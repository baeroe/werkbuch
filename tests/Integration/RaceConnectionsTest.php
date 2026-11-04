<?php

use App\Models\Organization;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Tests\Support\RaceConnections;

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('rolls back a transaction that hold() left open when it tears down', function () {
    RaceConnections::hold(fn () => null);

    expect(DB::connection('mariadb')->transactionLevel())->toBe(1);

    RaceConnections::tearDown();

    expect(DB::connection('mariadb')->transactionLevel())->toBe(0);
});

it('commits the first connection before the lock of the second with the first as the default connection', function () {
    $seen = [];

    // what runs after the commit of the first request (the outbox) runs on the default connection
    RaceConnections::hold(function () use (&$seen) {
        DB::connection('mariadb')->afterCommit(function () use (&$seen) {
            $seen[] = DB::getDefaultConnection();
        });
    });
    RaceConnections::releaseBeforeLock('organization');

    RaceConnections::second(function () use (&$seen) {
        CatalogLock::take();
        $seen[] = DB::getDefaultConnection();
    });

    expect($seen)->toBe(['mariadb', 'mariadb_second'])
        ->and(DB::connection('mariadb')->transactionLevel())->toBe(0);
});

it('commits the first connection before a shared lock of the second', function () {
    // connection 1: a change of the catalogs holds the organization for update
    RaceConnections::hold(fn () => CatalogLock::take());
    RaceConnections::releaseBeforeLock('organization', 'lock in share mode');

    // connection 2: a change of items asks for it shared and gets it once connection 1 is done
    expect(RaceConnections::second(fn () => DB::transaction(fn () => CatalogLock::share())))->toBeInstanceOf(Organization::class)
        ->and(DB::connection('mariadb')->transactionLevel())->toBe(0);
});

it('waits for the shared lock of the organization behind a change of the catalogs', function () {
    RaceConnections::hold(fn () => CatalogLock::share());

    // shared locks share; the lock for update waits for them
    expect(RaceConnections::second(fn () => DB::transaction(fn () => CatalogLock::share())))->toBeInstanceOf(Organization::class);
    RaceConnections::expectLockWait(RaceConnections::second(fn () => DB::transaction(fn () => CatalogLock::take())), 'organization');
});
