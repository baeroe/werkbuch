<?php

use App\Enums\Locale;
use App\Models\User;
use App\Notifications\ResetPasswordNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
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
