<?php

use App\Access\ProjectRole;
use App\Actions\Auth\AcceptInvitation;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Invitation;
use App\Models\Project;
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
    $web = Project::factory()->create();
    $invitation = Invitation::factory()->create([
        'email' => 'lea@example.com',
        'projects' => [['project_id' => $web->id, 'role' => ProjectRole::Member->value]],
    ]);
    $before = Event::query()->pluck('id')->all();
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

    // the first accept wrote the account and its membership once; the refused second wrote no event at all
    $created = eventsOf(EventType::UserCreated, $lea);
    $added = eventsOf(EventType::ProjectMemberAdded, $web);
    expect($created)->toHaveCount(1)
        ->and($added)->toHaveCount(1)
        ->and($added->sole()->changes['member']['new'] ?? null)->toBe(['user_id' => $lea->id, 'role' => 'member'])
        ->and(Event::query()->whereNotIn('id', $before)->orderBy('id')->pluck('id')->all())
        ->toBe(collect([$created->sole()->id, $added->sole()->id])->sort()->values()->all());
});
