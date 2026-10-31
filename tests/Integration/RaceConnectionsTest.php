<?php

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
