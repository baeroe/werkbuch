<?php

use App\Events\EventType;
use App\Models\Event;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;

/*
 * The way back when the authenticator app and the recovery codes are lost: app:reset-two-factor turns the second factor
 * off and ends the sessions of the account.
 */

it('turns the second factor off, ends the sessions and notes why', function () {
    config(['session.driver' => 'database']);
    $user = User::factory()->create(['remember_token' => 'old-token']);
    app(EnableTwoFactorAuthentication::class)($user, true);
    $user->forceFill(['two_factor_confirmed_at' => now()])->save();
    DB::table('sessions')->insert(['id' => 'sess-1', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()]);

    $this->artisan('app:reset-two-factor', ['email' => $user->email])
        ->expectsOutputToContain("Two-factor sign-in turned off for {$user->email}; all sessions ended.")
        ->assertSuccessful();

    $user->refresh();
    $event = Event::query()->where('type', EventType::UserTwoFactorDisabled)->sole();
    expect([$user->two_factor_secret, $user->two_factor_recovery_codes, $user->two_factor_confirmed_at])->toBe([null, null, null])
        ->and($user->remember_token)->not->toBe('old-token')
        ->and(DB::table('sessions')->where('user_id', $user->id)->count())->toBe(0)
        ->and([$event->actor_id, $event->subject_id, $event->meta['via'], $event->meta['reason']])->toBe([$user->id, $user->id, 'system', 'two_factor_reset']);

    // the person signs in with the password alone again
    $this->post('/login', ['email' => $user->email, 'password' => 'password'])->assertRedirect('/my-items');
});

it('changes nothing for an account without a second factor', function () {
    $user = User::factory()->create();

    $this->artisan('app:reset-two-factor', ['email' => $user->email])
        ->expectsOutputToContain("Two-factor sign-in is off already for {$user->email}; nothing changed.")
        ->assertSuccessful();

    expect(Event::query()->where('type', EventType::UserTwoFactorDisabled)->exists())->toBeFalse();
});

it('fails for an unknown address', function () {
    $this->artisan('app:reset-two-factor', ['email' => 'nobody@example.com'])
        ->expectsOutputToContain('There is no account with this email.')
        ->assertFailed();
});
