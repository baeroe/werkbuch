<?php

use App\Actions\Auth\SendPasswordResetLink;
use App\Enums\Locale;
use App\Models\User;
use App\Notifications\ResetPasswordNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Queue;
use Inertia\Testing\AssertableInertia as Assert;

it('builds the reset link from APP_URL, not from the request host, and mails in the language of the account', function () {
    Notification::fake();
    config(['app.url' => 'https://pm.example.com']);
    $user = User::factory()->locale(Locale::De)->create(['email' => 'lene@example.com']);

    $this->withHeader('Host', 'evil.example.net')->post('/forgot-password', ['email' => 'lene@example.com'])->assertSessionHas('status');

    Notification::assertSentTo($user, ResetPasswordNotification::class, fn ($n) => str_starts_with($n->toMail($user)->actionUrl, 'https://pm.example.com/reset-password/') && $n->locale === 'de');
});

it('puts the token and the address into the link', function () {
    config(['app.url' => 'https://pm.example.com/']);
    $user = User::factory()->create(['email' => 'lene+pm@example.com']);

    $mail = (new ResetPasswordNotification('tok123'))->toMail($user);

    expect($mail->actionUrl)->toBe('https://pm.example.com/reset-password/tok123?email=lene%2Bpm%40example.com');
});

it('mails in the language of the organization when the account has none', function () {
    Notification::fake();
    config(['app.locale' => 'de']);
    $user = User::factory()->create(['email' => 'lene@example.com']);

    $this->post('/forgot-password', ['email' => 'lene@example.com']);

    Notification::assertSentTo($user, ResetPasswordNotification::class, fn ($n) => $n->locale === 'de');
});

it('writes the mail with the texts of the app in the language of the account', function (Locale $locale) {
    $user = User::factory()->locale($locale)->create(['name' => 'Lene Example', 'email' => 'lene@example.com']);
    $notification = (new ResetPasswordNotification('tok123'))->locale($user->preferredLocale());

    app()->setLocale($locale->value);
    $mail = $notification->toMail($user);
    $html = (string) $mail->render();

    expect($mail->subject)->toBe(trans('mail.reset_password.subject', [], $locale->value))
        ->and($mail->actionText)->toBe(trans('mail.reset_password.action', [], $locale->value))
        ->and($html)->toContain(e(trans('mail.reset_password.greeting', ['name' => 'Lene Example'], $locale->value)))
        ->toContain(e(trans('mail.reset_password.expiry', ['minutes' => 60], $locale->value)))
        ->toContain(e(trans('mail.layout.regards', [], $locale->value)))
        ->toContain(e(trans('mail.layout.trouble', ['action' => $mail->actionText], $locale->value)))
        ->not->toContain('Regards,')->not->toContain('All rights reserved')->not->toContain('trouble clicking');
})->with([Locale::En, Locale::De]);

it('answers the same for unknown, disabled and throttled addresses', function () {
    Notification::fake();
    User::factory()->create(['email' => 'lene@example.com']);
    User::factory()->disabled()->create(['email' => 'sven@example.com']);
    $this->post('/forgot-password', ['email' => 'lene@example.com']);

    foreach (['nobody@example.com', 'sven@example.com', 'lene@example.com'] as $email) {
        $this->from('/forgot-password')->post('/forgot-password', ['email' => $email])
            ->assertRedirect('/forgot-password')->assertSessionHas('status', __('passwords.sent'))->assertSessionHasNoErrors();
    }
    Notification::assertSentTimes(ResetPasswordNotification::class, 1);
});

it('answers a known address like the others', function () {
    Notification::fake();
    User::factory()->create(['email' => 'lene@example.com']);

    $this->from('/forgot-password')->post('/forgot-password', ['email' => 'Lene@Example.com'])
        ->assertRedirect('/forgot-password')->assertSessionHas('status', __('passwords.sent'))->assertSessionHasNoErrors();
    Notification::assertSentTimes(ResetPasswordNotification::class, 1);
});

it('answers at once with the same response and leaves the link to a job on the notifications queue', function (Closure $make, string $email) {
    $make();
    $tokens = DB::table('password_reset_tokens')->count();
    Queue::fake();
    Notification::fake();

    $response = $this->from('/forgot-password')->post('/forgot-password', ['email' => $email]);

    $response->assertRedirect('/forgot-password')->assertSessionHas('status', __('passwords.sent'))->assertSessionHasNoErrors();
    SendPasswordResetLink::assertPushedOn('notifications', 1, fn ($action, array $parameters) => $parameters === [strtolower($email)]);
    // no broker in the request: no token written, no mail sent
    expect(DB::table('password_reset_tokens')->count())->toBe($tokens);
    Notification::assertNothingSent();
})->with([
    'known' => [fn () => User::factory()->create(['email' => 'lene@example.com']), 'Lene@Example.com'],
    'unknown' => [fn () => null, 'nobody@example.com'],
    'disabled' => [fn () => User::factory()->disabled()->create(['email' => 'sven@example.com']), 'sven@example.com'],
    'throttled' => [fn () => Password::createToken(User::factory()->create(['email' => 'lene@example.com'])), 'lene@example.com'],
]);

it('refuses an empty or malformed address at the field without a job', function (mixed $email) {
    Queue::fake();

    $this->from('/forgot-password')->post('/forgot-password', ['email' => $email])
        ->assertRedirect('/forgot-password')->assertSessionHasErrors('email')->assertSessionMissing('status');
    SendPasswordResetLink::assertNotPushed();
})->with(['empty' => '', 'malformed' => 'lene', 'array' => [['lene@example.com']]]);

it('mails the link from the job only to an existing, active person', function () {
    Notification::fake();
    $lene = User::factory()->create(['email' => 'lene@example.com']);
    User::factory()->disabled()->create(['email' => 'sven@example.com']);
    User::factory()->bot()->create(['email' => 'bot@example.com']);

    foreach (['lene@example.com', 'sven@example.com', 'bot@example.com', 'nobody@example.com', 'lene@example.com'] as $email) {
        SendPasswordResetLink::run($email);
    }

    Notification::assertSentTimes(ResetPasswordNotification::class, 1);
    Notification::assertSentTo($lene, ResetPasswordNotification::class);
});

it('limits the reset links per IP and names the wait at the email field', function () {
    Queue::fake();
    $this->freezeTime();

    foreach (range(1, 6) as $i) {
        $this->from('/forgot-password')->post('/forgot-password', ['email' => "u{$i}@example.com"])->assertSessionHas('status');
    }
    $this->travel(20)->seconds();

    $this->from('/forgot-password')->withHeader('X-Inertia', 'true')->post('/forgot-password', ['email' => 'lene@example.com'])
        ->assertRedirect('/forgot-password')
        ->assertSessionHasErrors(['email' => __('auth.throttle', ['seconds' => 40])])
        ->assertSessionHasInput('email', 'lene@example.com')
        ->assertSessionMissing('status');
    SendPasswordResetLink::assertPushed(6);

    $this->travel(41)->seconds();
    $this->from('/forgot-password')->post('/forgot-password', ['email' => 'lene@example.com'])->assertSessionHas('status');
});

it('sends nothing to bots', function () {
    Notification::fake();
    User::factory()->bot()->create(['email' => 'bot@example.com']);

    $this->from('/forgot-password')->post('/forgot-password', ['email' => 'bot@example.com'])->assertSessionHas('status', __('passwords.sent'));
    Notification::assertNothingSent();
});

it('sets the new password, ends other sessions and leads to the sign-in', function () {
    $user = User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);
    DB::table('sessions')->insert(['id' => 's1', 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()]);

    $this->post('/reset-password', ['token' => Password::createToken($user), 'email' => 'lene@example.com', 'password' => 'new-password', 'password_confirmation' => 'new-password'])
        ->assertRedirect('/login')->assertSessionHas('status', __('passwords.reset'));
    expect(Hash::check('new-password', $user->fresh()->password))->toBeTrue()
        ->and(DB::table('sessions')->where('user_id', $user->id)->count())->toBe(0);
    $this->assertGuest();
});

it('names the reason of a used or expired link at the field', function () {
    $user = User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);
    $token = Password::createToken($user);
    $reset = fn () => $this->from('/reset-password/'.$token)->post('/reset-password', ['token' => $token, 'email' => 'lene@example.com', 'password' => 'new-password', 'password_confirmation' => 'new-password']);

    $reset()->assertRedirect('/login');

    $reset()->assertRedirect('/reset-password/'.$token)->assertSessionHasErrors(['email' => __('passwords.token')]);
});

it('names the same reason for an expired link and for an unknown address', function () {
    $user = User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);
    $token = Password::createToken($user);
    $this->travel(61)->minutes();

    foreach (['lene@example.com', 'nobody@example.com'] as $email) {
        $this->from('/reset-password/'.$token)->post('/reset-password', ['token' => $token, 'email' => $email, 'password' => 'new-password', 'password_confirmation' => 'new-password'])
            ->assertSessionHasErrors(['email' => __('passwords.token')]);
    }
    expect(Hash::check('old-password', $user->fresh()->password))->toBeTrue();
});

it('refuses short and unrepeated passwords', function (string $password, string $confirmation) {
    $user = User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);

    $this->from('/reset-password/x')->post('/reset-password', ['token' => Password::createToken($user), 'email' => 'lene@example.com', 'password' => $password, 'password_confirmation' => $confirmation])
        ->assertRedirect('/reset-password/x')->assertSessionHasErrors('password')->assertSessionDoesntHaveErrors('email');
    expect(Hash::check('old-password', $user->fresh()->password))->toBeTrue();
})->with([['short', 'short'], ['new-password', 'other-password']]);

it('refuses a password that is no text at the field', function () {
    $user = User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);

    $this->from('/reset-password/x')->post('/reset-password', ['token' => Password::createToken($user), 'email' => 'lene@example.com', 'password' => ['new-password'], 'password_confirmation' => ['new-password']])
        ->assertRedirect('/reset-password/x')->assertSessionHasErrors('password');
    expect(Hash::check('old-password', $user->fresh()->password))->toBeTrue();
});

it('refuses an address or a token that is no text at the field instead of failing', function (string $field) {
    $user = User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);
    // a pending token: the broker would compare an array token against its hash
    $data = ['token' => Password::createToken($user), 'email' => 'lene@example.com', 'password' => 'new-password', 'password_confirmation' => 'new-password'];
    $data[$field] = [$data[$field]];

    $this->from('/reset-password/x')->post('/reset-password', $data)
        ->assertRedirect('/reset-password/x')->assertSessionHasErrors($field);
    expect(Hash::check('old-password', $user->fresh()->password))->toBeTrue();
})->with(['email', 'token']);

it('limits the new passwords per IP, apart from the reset links, and names the wait at the email field', function () {
    Queue::fake();
    $this->freezeTime();
    $attempt = fn () => $this->from('/reset-password/x')->post('/reset-password', ['token' => 'wrong', 'email' => 'lene@example.com', 'password' => 'new-password', 'password_confirmation' => 'new-password']);

    foreach (range(1, 10) as $i) {
        $attempt()->assertSessionHasErrors(['email' => __('passwords.token')]);
    }
    $this->travel(15)->seconds();

    $attempt()->assertRedirect('/reset-password/x')
        ->assertSessionHasErrors(['email' => __('auth.throttle', ['seconds' => 45])])
        ->assertSessionMissing('_old_input.password');
    // the budget of the reset links is untouched
    $this->from('/forgot-password')->post('/forgot-password', ['email' => 'lene@example.com'])->assertSessionHas('status');

    $this->travel(46)->seconds();
    $attempt()->assertSessionHasErrors(['email' => __('passwords.token')]);
});

it('shows the reset page with token and email', function () {
    $this->get('/reset-password/abc?email=lene%40example.com')->assertOk()
        ->assertInertia(fn (Assert $p) => $p->component('Auth/ResetPassword')->where('token', 'abc')->where('email', 'lene@example.com'));
});

it('shows the reset page without an address in the link', function () {
    $this->get('/reset-password/abc')->assertOk()
        ->assertInertia(fn (Assert $p) => $p->component('Auth/ResetPassword')->where('token', 'abc')->where('email', ''));
});

it('shows the forgot page to guests', function () {
    $this->get('/forgot-password')->assertOk()->assertInertia(fn (Assert $p) => $p->component('Auth/ForgotPassword'));
});
