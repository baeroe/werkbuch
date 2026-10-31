<?php

use App\Access\OrgRole;
use App\Access\Visibility;
use App\Actions\Users\UpdateUserRole;
use App\Exceptions\Problem;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
 * Two admins demote each other at the same time (P29). Two connections to the same database, without the test
 * transaction of RefreshDatabase: `mariadb` holds its transaction open like a request in progress, `mariadb_second` is
 * the other request. The second gives up waiting for a lock after one second instead of counting what it read before.
 */

beforeEach(function () {
    config(['database.connections.mariadb_second' => config('database.connections.mariadb')]);
    DB::connection('mariadb_second')->statement('SET innodb_lock_wait_timeout = 1');
});

afterEach(function () {
    DB::setDefaultConnection('mariadb');
    DB::purge('mariadb_second');
});

it('lets only one of two admins demote the other at the same time', function () {
    $mara = User::factory()->admin()->create(['name' => 'Mara']);
    $erik = User::factory()->admin()->create(['name' => 'Erik']);

    // connection 1: Mara demotes Erik and keeps the transaction open
    DB::connection('mariadb')->beginTransaction();
    UpdateUserRole::run(actor($mara), $erik, 'member');

    // connection 2: Erik demotes Mara meanwhile. Without the commit of connection 1 Erik is still an admin there, so
    // a count without the lock would let it through (and only wait later, at the write, with its stale count); the
    // lock makes the count itself wait
    DB::setDefaultConnection('mariadb_second');
    Visibility::forget();
    $timeout = null;

    try {
        UpdateUserRole::run(actor($erik), User::query()->findOrFail($mara->id), 'member');
    } catch (QueryException $exception) {
        $timeout = $exception;
    }

    expect($timeout?->getMessage())->toContain('Lock wait timeout')
        ->and($timeout?->getSql())->toStartWith('select `users`.`id` from `users`')->toEndWith('for update');

    DB::setDefaultConnection('mariadb');
    DB::connection('mariadb')->commit();

    // once connection 1 is done, the waiting request goes on and counts afresh; its rights were checked before it
    // waited, the default bot (an admin that never counts) stands in for that
    DB::setDefaultConnection('mariadb_second');
    $refusal = null;

    try {
        UpdateUserRole::run(Actor::system(User::defaultBot(), 'race'), User::query()->findOrFail($mara->id), 'member');
    } catch (Problem $problem) {
        $refusal = $problem;
    }

    expect($refusal?->status)->toBe(409)->and($refusal?->reason)->toBe('last_admin');

    DB::setDefaultConnection('mariadb');
    Visibility::forget();
    $admins = User::query()->where('is_default_bot', false)->get()->filter(fn (User $user) => Visibility::orgRole($user) === OrgRole::Admin);
    expect($admins->pluck('name')->values()->all())->toBe(['Mara']);
});
