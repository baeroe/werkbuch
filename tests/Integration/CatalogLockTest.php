<?php

use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Tests\Support\RaceConnections;

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('takes the row of the organization for update', function () {
    // connection 1: a request holds the lock in its open transaction
    RaceConnections::hold(fn () => CatalogLock::take());

    // connection 2: the next one has to wait for it and gives up after a second
    $timeout = RaceConnections::second(fn () => DB::transaction(fn () => CatalogLock::take()));

    RaceConnections::expectLockWait($timeout, 'organization');

    RaceConnections::release();

    // once connection 1 is done, connection 2 gets the lock
    expect(RaceConnections::second(fn () => DB::transaction(fn () => CatalogLock::take())))->toBeNull();
});
