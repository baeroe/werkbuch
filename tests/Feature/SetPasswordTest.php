<?php

use App\Actions\Auth\SetPassword;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

function sessionFor(User $user, string $id): void
{
    DB::table('sessions')->insert(['id' => $id, 'user_id' => $user->id, 'ip_address' => null, 'user_agent' => null, 'payload' => '', 'last_activity' => time()]);
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
        ->and(DB::table('sessions')->where('user_id', $user->id)->count())->toBe(1);
});
