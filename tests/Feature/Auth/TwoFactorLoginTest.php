<?php

use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use PragmaRX\Google2FA\Google2FA;

/*
 * Signing in with a second factor (spec 4.2): after the right password a person with confirmed two-factor sign-in
 * types the code of the app (or a recovery code, which works once) before the session starts.
 */

/** Mara with confirmed two-factor sign-in; the password is `secret-pass`. */
function maraWithTwoFactor(): User
{
    $mara = User::factory()->create(['email' => 'mara@example.com', 'password' => 'secret-pass']);
    app(EnableTwoFactorAuthentication::class)($mara, true);
    $mara->forceFill(['two_factor_confirmed_at' => now()])->save();

    return $mara;
}

function currentCode(User $user): string
{
    return app(Google2FA::class)->getCurrentOtp(decrypt((string) $user->two_factor_secret));
}

it('asks for the code after the right password, before the session starts', function () {
    maraWithTwoFactor();

    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertRedirect('/two-factor-challenge');

    $this->assertGuest();
    $this->get('/two-factor-challenge')->assertOk()->assertInertia(fn (Assert $page) => $page->component('Auth/TwoFactorChallenge'));
});

it('signs in with the code of the app', function () {
    $mara = maraWithTwoFactor();
    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass']);

    $this->post('/two-factor-challenge', ['code' => currentCode($mara)])->assertRedirect('/my-items');

    $this->assertAuthenticatedAs($mara);
});

it('signs in with a recovery code, which then is used up', function () {
    $mara = maraWithTwoFactor();
    $code = $mara->recoveryCodes()[3];
    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass']);

    $this->post('/two-factor-challenge', ['recovery_code' => $code])->assertRedirect('/my-items');

    $this->assertAuthenticatedAs($mara);
    expect($mara->fresh()?->recoveryCodes())->toHaveCount(7)->not->toContain($code);
    $this->getJson('/api/v1/me/two-factor')->assertJsonPath('recovery_codes_left', 7);

    $this->post('/logout');
    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass']);
    $this->from('/two-factor-challenge')->post('/two-factor-challenge', ['recovery_code' => $code])
        ->assertRedirect('/two-factor-challenge')->assertSessionHasErrors(['recovery_code' => __('two_factor_challenge.recovery_code_wrong')]);
    $this->assertGuest();
});

it('names a wrong code at the field and stays signed out', function () {
    maraWithTwoFactor();
    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass']);

    $this->post('/two-factor-challenge', ['code' => '000000'])
        ->assertRedirect('/two-factor-challenge')->assertSessionHasErrors(['code' => __('field.code.wrong')]);

    $this->assertGuest();
});

it('limits the challenge to five tries a minute and names the wait at the field in use', function (string $field) {
    $this->freezeTime();
    maraWithTwoFactor();
    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass']);

    foreach (range(1, 5) as $i) {
        $this->post('/two-factor-challenge', [$field => 'nope'])->assertSessionHasErrors([$field => __($field === 'code' ? 'field.code.wrong' : 'two_factor_challenge.recovery_code_wrong')]);
    }
    $this->from('/two-factor-challenge')->post('/two-factor-challenge', [$field => 'nope'])
        ->assertRedirect('/two-factor-challenge')->assertSessionHasErrors([$field => __('auth.throttle', ['seconds' => 60])]);

    $this->assertGuest();
})->with(['code', 'recovery_code']);

it('counts the tries per account that signs in', function () {
    maraWithTwoFactor();
    $ida = User::factory()->create(['email' => 'ida@example.com', 'password' => 'secret-pass']);
    app(EnableTwoFactorAuthentication::class)($ida, true);
    $ida->forceFill(['two_factor_confirmed_at' => now()])->save();

    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass']);
    foreach (range(1, 6) as $i) {
        $this->post('/two-factor-challenge', ['code' => '000000']);
    }
    $this->flushSession();
    $this->post('/login', ['email' => 'ida@example.com', 'password' => 'secret-pass']);

    $this->post('/two-factor-challenge', ['code' => currentCode($ida)])->assertRedirect('/my-items');
    $this->assertAuthenticatedAs($ida);
});

it('sends a visitor without a started sign-in to the sign-in', function () {
    $this->get('/two-factor-challenge')->assertRedirect('/login');
    $this->post('/two-factor-challenge', ['code' => '123456'])->assertRedirect('/two-factor-challenge')->assertSessionHasErrors('code');
    $this->assertGuest();
});

it('sends signed-in people on', function () {
    $this->actingAs(User::factory()->create())->get('/two-factor-challenge')->assertRedirect('/my-items');
});

it('signs a person without two-factor sign-in in directly, also during an unconfirmed setup', function (bool $started) {
    $lene = User::factory()->create(['email' => 'lene@example.com', 'password' => 'secret-pass']);
    if ($started) {
        app(EnableTwoFactorAuthentication::class)($lene, true);
    }

    $this->post('/login', ['email' => 'lene@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');

    $this->assertAuthenticatedAs($lene);
})->with(['without' => false, 'setup started' => true]);

it('answers wrong passwords and unknown addresses as before, whether the account has a second factor or not', function (string $email, string $password) {
    maraWithTwoFactor();

    $this->from('/login')->post('/login', ['email' => $email, 'password' => $password])
        ->assertRedirect('/login')->assertSessionHasErrors(['email' => __('auth.failed')])->assertSessionMissing('login.id');
    $this->assertGuest();
})->with([
    'two-factor account, wrong password' => ['mara@example.com', 'wrong-pass'],
    'unknown address' => ['nobody@example.com', 'secret-pass'],
]);

it('refuses a disabled account with a second factor like any other', function () {
    $mara = maraWithTwoFactor();
    $mara->update(['disabled_at' => now()]);

    $this->from('/login')->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])
        ->assertRedirect('/login')->assertSessionHasErrors(['email' => __('auth.failed')])->assertSessionMissing('login.id');
});
