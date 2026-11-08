<?php

use App\Actions\Auth\AcceptInvitation;
use App\Models\Invitation;
use App\Models\User;
use Illuminate\Validation\ValidationException;
use Tests\Support\RaceConnections;

/*
 * Two requests accept the same invitation at the same time. Two connections to the same database, without the test
 * transaction: `mariadb` holds its transaction open like an accept in progress, `mariadb_second` is the other request.
 * The first commits at the moment the second asks for the lock on the invitation; under the lock the second reads
 * `accepted_at` and gets the state `closed`.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('makes one account of two accepts at once', function () {
    $invitation = Invitation::factory()->create(['email' => 'lea@example.com']);
    $second = Invitation::query()->findOrFail($invitation->id);

    // connection 1: Lea accepts and the request has not committed yet
    $lea = RaceConnections::hold(fn () => AcceptInvitation::run($invitation, ['name' => 'Lea Sommer', 'password' => 'secret-pass']));

    // connection 2: the same link again, with the invitation it loaded while it was still open; the first one commits
    // just as the second asks for the lock
    RaceConnections::releaseBeforeLock('invitations');
    $refusal = RaceConnections::second(fn () => AcceptInvitation::run($second, ['name' => 'Lea Zwei', 'password' => 'other-pass']));

    expect($refusal)->toBeInstanceOf(ValidationException::class)
        ->and($refusal instanceof ValidationException ? $refusal->errors() : null)->toBe(['invitation' => [__('invitation.closed')]])
        ->and(User::query()->where('email', 'lea@example.com')->sole()->is($lea))->toBeTrue()
        ->and(Invitation::query()->findOrFail($invitation->id)->accepted_at)->not->toBeNull();
});
