<?php

use App\Actions\Auth\SetPassword;
use App\Events\EventType;
use App\Models\Event;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

// the sessions live in the table of the database driver (the default outside tests)
beforeEach(fn () => config(['session.driver' => 'database', 'session.table' => 'sessions']));

function sessionFor(User $user, string $id): void
{
    DB::table(config('session.table'))->insert(['id' => $id, 'user_id' => $user->id, 'ip_address' => null, 'user_agent' => null, 'payload' => '', 'last_activity' => time()]);
}

it('sets the password, renews the remember token and ends the sessions of the account only', function () {
    $user = User::factory()->create(['password' => 'old-password', 'remember_token' => 'old-token']);
    $other = User::factory()->create();
    sessionFor($user, 'sess-own-1');
    sessionFor($user, 'sess-own-2');
    sessionFor($other, 'sess-other');

    app(SetPassword::class)->handle($user, 'new-password');

    $user->refresh();
    expect(Hash::check('new-password', (string) $user->password))->toBeTrue()
        ->and($user->remember_token)->not->toBe('old-token')->and($user->remember_token)->toHaveLength(60)
        ->and(DB::table('sessions')->where('user_id', $user->id)->count())->toBe(0)
        ->and(DB::table('sessions')->where('user_id', $other->id)->count())->toBe(1);
});

it('notes user.password_changed by the system, without the password', function () {
    $user = User::factory()->create();

    SetPassword::run($user, 'new-password');

    $event = Event::query()->where('type', EventType::UserPasswordChanged)->sole();
    $json = (string) json_encode(Event::query()->whereKey($event->id)->toBase()->sole(), JSON_UNESCAPED_SLASHES);

    expect([$event->subject_id, $event->actor_id, $event->changes])->toBe([$user->id, $user->id, null])
        ->and($event->meta)->toBe(['via' => 'system', 'reason' => 'password_reset'])
        ->and($json)->not->toContain('new-password')
        ->and($json)->not->toContain((string) $user->fresh()?->password);
});

it('notes the account that changes it and the reason, and keeps the session of the request', function () {
    $user = User::factory()->create();
    $keep = session()->getId();
    sessionFor($user, $keep);
    sessionFor($user, 'sess-elsewhere');

    SetPassword::run($user, 'new-password', actor($user), keepSession: true, reason: 'password_change');

    expect(Event::query()->where('type', EventType::UserPasswordChanged)->sole()->meta)->toBe(['via' => 'ui', 'reason' => 'password_change'])
        ->and(DB::table('sessions')->pluck('id')->all())->toBe([$keep]);
});

it('refuses a short password and changes nothing', function () {
    $user = User::factory()->create(['password' => 'old-password', 'remember_token' => 'old-token']);
    sessionFor($user, 'sess-own');

    try {
        app(SetPassword::class)->handle($user, 'short');
        $this->fail('Expected a ValidationException.');
    } catch (ValidationException $e) {
        expect(array_keys($e->errors()))->toBe(['password']);
    }

    $user->refresh();
    expect(Hash::check('old-password', (string) $user->password))->toBeTrue()
        ->and($user->remember_token)->toBe('old-token')
        ->and(DB::table('sessions')->where('user_id', $user->id)->count())->toBe(1)
        ->and(Event::query()->where('type', EventType::UserPasswordChanged)->exists())->toBeFalse();
});
