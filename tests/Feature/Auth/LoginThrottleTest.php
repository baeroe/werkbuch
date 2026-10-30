<?php

use App\Enums\Locale;
use App\Models\User;
use Laravel\Fortify\Actions\AttemptToAuthenticate;
use Laravel\Fortify\Actions\CanonicalizeUsername;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use Laravel\Fortify\Actions\EnsureLoginIsNotThrottled;
use Laravel\Fortify\Actions\PrepareAuthenticatedSession;
use Laravel\Fortify\Actions\RedirectIfTwoFactorAuthenticatable;
use Laravel\Fortify\Fortify;

beforeEach(function () {
    $this->freezeTime();
    User::factory()->create(['email' => 'mara@example.com', 'password' => 'secret-pass']);
});

/** Five failed attempts for Mara from the default test IP. */
function failFiveTimesAsMara(): void
{
    foreach (range(1, 5) as $i) {
        test()->post('/login', ['email' => 'mara@example.com', 'password' => 'nope']);
    }
}

it('locks the email for this IP after five failures, even with the right password', function () {
    foreach (['MARA@example.com', ' Mara@Example.com ', 'mara@example.com', ' mara@example.com', 'Mara@example.com '] as $email) {
        $this->post('/login', ['email' => $email, 'password' => 'nope']);
    }
    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])
        ->assertSessionHasErrors(['email' => __('auth.throttle', ['seconds' => 60])]);
    $this->assertGuest();
});

it('still lets the fifth attempt through', function () {
    foreach (range(1, 4) as $i) {
        $this->post('/login', ['email' => 'mara@example.com', 'password' => 'nope']);
    }

    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    $this->assertAuthenticated();
});

it('keeps other emails from this IP and this email from other IPs free', function () {
    User::factory()->create(['email' => 'ida@example.com', 'password' => 'secret-pass']);
    failFiveTimesAsMara();

    $this->post('/login', ['email' => 'ida@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    $this->assertAuthenticated();
    $this->post('/logout');

    $this->withServerVariables(['REMOTE_ADDR' => '10.9.9.9'])
        ->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    $this->assertAuthenticated();
});

it('unlocks after 60 seconds', function () {
    failFiveTimesAsMara();
    $this->travel(59)->seconds();
    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])
        ->assertSessionHasErrors(['email' => __('auth.throttle', ['seconds' => 1])]);

    $this->travel(2)->seconds();
    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    $this->assertAuthenticated();
});

it('answers the 21st attempt of an IP within a minute with a field error, not a 429 page', function () {
    foreach (range(1, 20) as $i) {
        $this->post('/login', ['email' => "u{$i}@example.com", 'password' => 'nope']);
    }
    $this->from('/login')->withHeader('X-Inertia', 'true')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])
        ->assertRedirect('/login')->assertSessionHasErrors('email');
    $this->assertGuest();
});

it('names the wait of the IP limit in seconds, in the language of the visitor, and keeps the email', function () {
    foreach (range(1, 20) as $i) {
        $this->post('/login', ['email' => "u{$i}@example.com", 'password' => 'nope']);
    }
    $this->travel(15)->seconds();

    $this->from('/login')->withUnencryptedCookie('locale', Locale::De->value)
        ->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])
        ->assertRedirect('/login')
        ->assertSessionHasErrors(['email' => trans('auth.throttle', ['seconds' => 45], 'de')])
        ->assertSessionHasInput('email', 'mara@example.com')
        ->assertSessionMissing('_old_input.password');
});

it('lets the IP sign in again after a minute', function () {
    foreach (range(1, 20) as $i) {
        $this->post('/login', ['email' => "u{$i}@example.com", 'password' => 'nope']);
    }
    $this->travel(61)->seconds();

    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');
});

it('signs in through the lock, the lower-cased address, the second factor and only then the session', function () {
    // Fortify drops the lock from its own pipeline once a named limiter is set, so the pipeline is werkbuch's
    expect(call_user_func(Fortify::$authenticateThroughCallback, request()))->toBe([
        EnsureLoginIsNotThrottled::class,
        CanonicalizeUsername::class,
        RedirectIfTwoFactorAuthenticatable::class,
        AttemptToAuthenticate::class,
        PrepareAuthenticatedSession::class,
    ]);
});

it('locks an address with a second factor before it asks for the code', function () {
    $mara = User::query()->where('email', 'mara@example.com')->sole();
    app(EnableTwoFactorAuthentication::class)($mara, true);
    $mara->forceFill(['two_factor_confirmed_at' => now()])->save();
    failFiveTimesAsMara();

    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])
        ->assertSessionHasErrors(['email' => __('auth.throttle', ['seconds' => 60])])->assertSessionMissing('login.id');

    $this->travel(61)->seconds();
    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertRedirect('/two-factor-challenge');
});
