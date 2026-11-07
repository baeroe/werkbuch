<?php

use App\Auth\AccountLoginRateLimiter;
use App\Auth\KnownDevice;
use App\Auth\TwoFactorDay;
use App\Models\User;
use Illuminate\Auth\Events\Login;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use Laravel\Fortify\LoginRateLimiter;
use PragmaRX\Google2FA\Google2FA;

/*
 * The cap per account over all addresses (A434): behind a forgeable X-Forwarded-For every IP limit is moot, so at most
 * `login_per_account` failures an hour count per address. A device that once signed in to exactly this address (cookie
 * `werkbuch_device`) is not held by the cap; a sign-in, also after the second factor, and a new password clear it.
 */

beforeEach(function () {
    Artisan::call('cache:clear');
    $this->freezeTime();
    config(['werkbuch.rate_limits.login_per_account' => 3]);
    User::factory()->create(['email' => 'mara@example.com', 'password' => 'secret-pass']);
});

$from = fn (string $ip) => test()->withServerVariables(['REMOTE_ADDR' => $ip]);

/** Three failures for Mara, each from an address of its own. */
$lockMara = function (string ...$ips) use ($from): void {
    foreach ($ips === [] ? ['10.0.0.1', '10.0.0.2', '10.0.0.3'] : $ips as $ip) {
        $from($ip)->post('/login', ['email' => 'mara@example.com', 'password' => 'nope'])
            ->assertSessionHasErrors(['email' => __('auth.failed')]);
    }
};

/** Mara signs in and out again; returns the device cookie her browser got (decrypted, as the server reads it). */
$deviceOfMara = function () use ($from): string {
    $device = $from('10.1.1.1')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])
        ->assertRedirect('/my-items')->getCookie(KnownDevice::NAME)?->getValue();
    test()->post('/logout');
    test()->assertGuest();
    expect($device)->toBeString();

    return (string) $device;
};

$withTwoFactor = function (User $user): User {
    app(EnableTwoFactorAuthentication::class)($user, true);
    $user->forceFill(['two_factor_confirmed_at' => now()])->save();

    return $user;
};

$code = fn (User $user): string => app(Google2FA::class)->getCurrentOtp(decrypt((string) $user->two_factor_secret));

$locked = fn (int $minutes = 60) => ['email' => __('auth.throttle_minutes', ['minutes' => $minutes])];

it('locks an account after the failures of many addresses', function () use ($from, $lockMara, $locked) {
    $lockMara();

    $from('10.0.0.4')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertSessionHasErrors($locked());

    $this->assertGuest();
    expect(RateLimiter::attempts('login-account:mara@example.com'))->toBe(3);
});

it('says the wait in minutes', function () use ($from, $lockMara) {
    $lockMara();
    $try = fn () => $from('10.0.0.4')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass']);

    $this->travel(61)->seconds();
    $try()->assertSessionHasErrors(['email' => __('auth.throttle_minutes', ['minutes' => 59])]);

    $this->travel(3600 - 61 - 120)->seconds();
    $try()->assertSessionHasErrors(['email' => __('auth.throttle_minutes', ['minutes' => 2])]);

    $this->travel(1)->seconds();
    $try()->assertSessionHasErrors(['email' => __('auth.throttle', ['seconds' => 119])]);
    $this->assertGuest();
});

it('words the wait in minutes in German', function () {
    expect(trans('auth.throttle_minutes', ['minutes' => 59], 'de'))->toBe('Zu viele Anmeldeversuche. Versuch es in 59 Minuten wieder.')
        ->and(trans('auth.throttle_minutes', ['minutes' => 59], 'en'))->toBe('Too many sign-in attempts. Try again in 59 minutes.');
});

it('counts the address in any case, with spaces and accents', function () use ($from, $locked) {
    foreach (['10.0.0.1' => 'Mara@Example.com ', '10.0.0.2' => 'mara@example.com', '10.0.0.3' => ' MARA@example.com'] as $ip => $email) {
        $from($ip)->post('/login', ['email' => $email, 'password' => 'nope']);
    }
    expect(RateLimiter::attempts('login-account:mara@example.com'))->toBe(3);
    $from('10.0.0.4')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertSessionHasErrors($locked());

    User::factory()->create(['email' => 'ärzte@example.com', 'password' => 'secret-pass']);
    foreach (['10.0.0.5' => 'Ärzte@example.com', '10.0.0.6' => 'ärzte@example.com', '10.0.0.7' => 'ÄRZTE@EXAMPLE.COM'] as $ip => $email) {
        $from($ip)->post('/login', ['email' => $email, 'password' => 'nope']);
    }
    expect(RateLimiter::attempts('login-account:arzte@example.com'))->toBe(3);
    $from('10.0.0.8')->post('/login', ['email' => 'ärzte@example.com', 'password' => 'secret-pass'])->assertSessionHasErrors($locked());
    $this->assertGuest();
});

it('clears the account after a sign-in', function () use ($from, $lockMara, $locked) {
    $lockMara('10.0.0.1', '10.0.0.2');
    $from('10.0.0.3')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    expect(RateLimiter::attempts('login-account:mara@example.com'))->toBe(0);
    $this->post('/logout');

    $lockMara('10.0.0.4', '10.0.0.5', '10.0.0.6');

    $from('10.0.0.7')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertSessionHasErrors($locked());
    $this->assertGuest();
});

it('signs in from a known device while the account is locked', function () use ($from, $lockMara, $deviceOfMara, $locked) {
    $device = $deviceOfMara();
    $lockMara();

    $from('10.0.0.5')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertSessionHasErrors($locked());
    $this->assertGuest();

    $from('10.0.0.6')->withCookie(KnownDevice::NAME, $device)
        ->post('/login', ['email' => 'Mara@Example.com ', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    $this->assertAuthenticated();
});

it('keeps the lock per address and IP on a known device', function () use ($from, $deviceOfMara) {
    $device = $deviceOfMara();

    foreach (range(1, 5) as $i) {
        $from('10.0.0.9')->withCookie(KnownDevice::NAME, $device)->post('/login', ['email' => 'mara@example.com', 'password' => 'nope']);
    }

    $from('10.0.0.9')->withCookie(KnownDevice::NAME, $device)->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])
        ->assertSessionHasErrors(['email' => __('auth.throttle', ['seconds' => 60])]);
    $this->assertGuest();
});

it('ignores the device cookie of another address', function () use ($from, $lockMara, $locked) {
    User::factory()->create(['email' => 'ida@example.com', 'password' => 'secret-pass']);
    $device = (string) $this->post('/login', ['email' => 'ida@example.com', 'password' => 'secret-pass'])
        ->assertRedirect('/my-items')->getCookie(KnownDevice::NAME)?->getValue();
    $this->post('/logout');
    $lockMara();

    $from('10.0.0.5')->withCookie(KnownDevice::NAME, $device)
        ->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertSessionHasErrors($locked());
    $this->assertGuest();
});

it('ignores a device cookie that was not issued by this instance', function (Closure $send) use ($from, $lockMara, $locked) {
    $lockMara();

    $send($from('10.0.0.5'))->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertSessionHasErrors($locked());
    $this->assertGuest();
})->with([
    'signed with another key' => [fn ($test) => $test->withCookie(KnownDevice::NAME, hash_hmac('sha256', 'mara@example.com', 'another-key'))],
    'the right value, not encrypted' => [fn ($test) => $test->withUnencryptedCookie(KnownDevice::NAME, hash_hmac('sha256', 'mara@example.com', (string) config('app.key')))],
    'the address itself' => [fn ($test) => $test->withCookie(KnownDevice::NAME, 'mara@example.com')],
]);

it('sets the device cookie for a year, only readable by the server', function () {
    $cookie = $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->getCookie(KnownDevice::NAME, decrypt: false);

    expect($cookie?->isHttpOnly())->toBeTrue()
        ->and($cookie?->getSameSite())->toBe('lax')
        ->and($cookie?->getExpiresTime())->toBe(now()->addMinutes(KnownDevice::MINUTES)->getTimestamp())
        ->and(KnownDevice::MINUTES)->toBe(60 * 24 * 365);
});

it('sets no device cookie for an account without an address', function () {
    event(new Login('web', User::factory()->bot()->create(), false));

    expect(Cookie::hasQueued(KnownDevice::NAME))->toBeFalse();
});

it('sets the device cookie after the second factor', function () use ($withTwoFactor, $code) {
    $mara = $withTwoFactor(User::query()->where('email', 'mara@example.com')->sole());

    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])
        ->assertRedirect('/two-factor-challenge')->assertCookieMissing(KnownDevice::NAME);

    $device = $this->post('/two-factor-challenge', ['code' => $code($mara)])->assertRedirect('/my-items')
        ->getCookie(KnownDevice::NAME)?->getValue();

    expect($device)->toBe(hash_hmac('sha256', 'mara@example.com', (string) config('app.key')));
});

it('clears the account after the second factor', function () use ($from, $lockMara, $withTwoFactor, $code) {
    $mara = $withTwoFactor(User::query()->where('email', 'mara@example.com')->sole());
    $lockMara('10.0.0.1', '10.0.0.2');

    $from('10.0.0.3')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertRedirect('/two-factor-challenge');
    expect(RateLimiter::attempts('login-account:mara@example.com'))->toBe(2);

    $from('10.0.0.3')->post('/two-factor-challenge', ['code' => $code($mara)])->assertRedirect('/my-items');

    expect(RateLimiter::attempts('login-account:mara@example.com'))->toBe(0);
});

it('clears the account and the day of codes with a new password', function () use ($from, $lockMara, $locked) {
    $mara = User::query()->where('email', 'mara@example.com')->sole();
    $lockMara();
    foreach (range(1, 4) as $i) {
        RateLimiter::hit(TwoFactorDay::cacheKey($mara->id), 86400);
    }
    $from('10.0.0.4')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertSessionHasErrors($locked());

    $this->post('/reset-password', ['token' => Password::createToken($mara), 'email' => 'mara@example.com', 'password' => 'new-password', 'password_confirmation' => 'new-password'])
        ->assertSessionHasNoErrors();

    expect(RateLimiter::attempts('login-account:mara@example.com'))->toBe(0)
        ->and(RateLimiter::attempts(TwoFactorDay::cacheKey($mara->id)))->toBe(0);
    $from('10.0.0.5')->post('/login', ['email' => 'mara@example.com', 'password' => 'new-password'])->assertRedirect('/my-items');
    $this->assertAuthenticatedAs($mara);
});

it('leaves other accounts alone', function () use ($from, $lockMara) {
    User::factory()->create(['email' => 'ida@example.com', 'password' => 'secret-pass']);
    $lockMara();

    $from('10.0.0.3')->post('/login', ['email' => 'ida@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    $this->assertAuthenticated();
});

it('keeps forgot-password open for a locked account', function () use ($lockMara) {
    Notification::fake();
    $lockMara();

    $this->from('/forgot-password')->post('/forgot-password', ['email' => 'mara@example.com'])
        ->assertRedirect('/forgot-password')->assertSessionHas('status', __('passwords.sent'))->assertSessionHasNoErrors();
    Notification::assertCount(1);
});

it('releases after the decay', function () use ($from, $lockMara) {
    $lockMara();

    $this->travel(3601)->seconds();

    $from('10.0.0.4')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    $this->assertAuthenticated();
});

it('counts only the lock per address and IP for an address that is no text', function () {
    $limiter = app(LoginRateLimiter::class);
    $request = Request::create('/login', 'POST', ['email' => 12345], server: ['REMOTE_ADDR' => '10.0.0.1']);

    foreach (range(1, 5) as $i) {
        $limiter->increment($request);
    }

    expect($limiter)->toBeInstanceOf(AccountLoginRateLimiter::class)
        ->and($limiter->tooManyAttempts($request))->toBeTrue()
        ->and($limiter->availableIn($request))->toBe(60)
        ->and(RateLimiter::attempts('login-account:12345'))->toBe(0);
});
