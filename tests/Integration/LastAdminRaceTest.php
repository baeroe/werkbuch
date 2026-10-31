<?php

use App\Access\OrgRole;
use App\Access\Visibility;
use App\Actions\Users\UpdateUserRole;
use App\Exceptions\Problem;
use App\Models\User;
use App\Support\Actor;
use Tests\Support\RaceConnections;

/*
 * Two admins demote each other at the same time (P29). Two connections to the same database, without the test
 * transaction of RefreshDatabase: `mariadb` holds its transaction open like a request in progress, `mariadb_second` is
 * the other request. The second gives up waiting for a lock after one second instead of counting what it read before.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('lets only one of two admins demote the other at the same time', function () {
    $mara = User::factory()->admin()->create(['name' => 'Mara']);
    $erik = User::factory()->admin()->create(['name' => 'Erik']);

    // connection 1: Mara demotes Erik and keeps the transaction open
    RaceConnections::hold(fn () => UpdateUserRole::run(actor($mara), $erik, 'member'));

    // connection 2: Erik demotes Mara meanwhile. Without the commit of connection 1 Erik is still an admin there, so
    // a count without the lock would let it through (and only wait later, at the write, with its stale count); the
    // lock makes the count itself wait
    $timeout = RaceConnections::second(function () use ($erik, $mara) {
        Visibility::forget();

        return UpdateUserRole::run(actor($erik), User::query()->findOrFail($mara->id), 'member');
    });

    RaceConnections::expectLockWait($timeout, 'users', 'select `users`.`id` from `users`');

    RaceConnections::release();

    // once connection 1 is done, the waiting request goes on and counts afresh; its rights were checked before it
    // waited, the default bot (an admin that never counts) stands in for that
    $refusal = RaceConnections::second(fn () => UpdateUserRole::run(Actor::system(User::defaultBot(), 'race'), User::query()->findOrFail($mara->id), 'member'));

    expect($refusal)->toBeInstanceOf(Problem::class)
        ->and($refusal instanceof Problem ? $refusal->status : null)->toBe(409)
        ->and($refusal instanceof Problem ? $refusal->reason : null)->toBe('last_admin');

    Visibility::forget();
    $admins = User::query()->where('is_default_bot', false)->get()->filter(fn (User $user) => Visibility::orgRole($user) === OrgRole::Admin);
    expect($admins->pluck('name')->values()->all())->toBe(['Mara']);
});
