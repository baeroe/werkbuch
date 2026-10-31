<?php

namespace App\Providers;

use App\Actions\Auth\Authenticate;
use App\Auth\FortifyResetUserPassword;
use App\Auth\RedirectToTwoFactorChallenge;
use App\Auth\TwoFactorCodes;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Inertia\Inertia;
use Laravel\Fortify\Actions\AttemptToAuthenticate;
use Laravel\Fortify\Actions\CanonicalizeUsername;
use Laravel\Fortify\Actions\EnsureLoginIsNotThrottled;
use Laravel\Fortify\Actions\PrepareAuthenticatedSession;
use Laravel\Fortify\Contracts\TwoFactorAuthenticationProvider;
use Laravel\Fortify\Fortify;
use PragmaRX\Google2FA\Google2FA;

/**
 * Sign-in with the optional second factor, sign-out and password reset through Fortify: the Inertia pages, the limits and
 * the hand-over to the actions. The routes are in routes/auth.php; POST /forgot-password and POST /reset-password are
 * werkbuch's own (App\Http\Controllers\Auth).
 */
final class FortifyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Fortify's route file would also register password confirmation (/user/confirm-password), which werkbuch does
        // not offer; routes/auth.php registers the routes werkbuch uses
        Fortify::ignoreRoutes();

        // TOTP codes count once per account, not once for everybody (Fortify's own provider remembers them per code)
        $this->app->singleton(TwoFactorAuthenticationProvider::class, fn ($app) => new TwoFactorCodes($app->make(Google2FA::class), $app->make(Repository::class)));
    }

    public function boot(): void
    {
        Fortify::loginView(fn () => Inertia::render('Auth/Login'));
        Fortify::requestPasswordResetLinkView(fn () => Inertia::render('Auth/ForgotPassword'));
        Fortify::resetPasswordView(fn (Request $request) => Inertia::render('Auth/ResetPassword', [
            'token' => (string) $request->route('token'),
            'email' => (string) $request->query('email', ''),
        ]));

        Fortify::authenticateUsing(fn (Request $request) => Authenticate::run(
            (string) $request->input(Fortify::username()),
            (string) $request->input('password'),
        ));

        // Fortify's own pipeline drops the lock per lower(email)|IP as soon as a named limiter is configured: keep it,
        // before the address is lowered (the lock key lowers it itself). The second factor comes before the session: with
        // the right password and a confirmed second factor, RedirectToTwoFactorChallenge (Fortify's step plus a stamp of the
        // password) leads to the challenge instead (a wrong password or an unknown address fails there exactly as without
        // it); everybody else goes on.
        Fortify::authenticateThrough(fn () => [
            EnsureLoginIsNotThrottled::class,
            CanonicalizeUsername::class,
            RedirectToTwoFactorChallenge::class,
            AttemptToAuthenticate::class,
            PrepareAuthenticatedSession::class,
        ]);

        Fortify::resetUserPasswordsUsing(FortifyResetUserPassword::class);

        // the limits per IP over all addresses (each its own budget); App\Exceptions\Rendering shows their 429 as an error at the email field (accepting an invitation: at the invitation)
        RateLimiter::for('login', fn (Request $request) => Limit::perMinute((int) config('werkbuch.rate_limits.login_per_ip'))->by((string) $request->ip()));
        RateLimiter::for('password-reset', fn (Request $request) => Limit::perMinute((int) config('werkbuch.rate_limits.password_reset_per_ip'))->by((string) $request->ip()));
        RateLimiter::for('password-update', fn (Request $request) => Limit::perMinute((int) config('werkbuch.rate_limits.password_update_per_ip'))->by((string) $request->ip()));
        // the challenge after the password: five codes a minute per sign-in that was started (Fortify's `login.id`)
        RateLimiter::for('two-factor', fn (Request $request) => Limit::perMinute(5)->by((string) $request->session()->get('login.id')));
        // changing the own password: six tries a minute per account (the current password is not to be guessed)
        RateLimiter::for('password-change', fn (Request $request) => Limit::perMinute(6)->by((string) ($request->user()?->getAuthIdentifier() ?? $request->ip())));
        RateLimiter::for('invitation', fn (Request $request) => Limit::perMinute((int) config('werkbuch.rate_limits.invitation_accept_per_ip'))->by((string) $request->ip()));
    }
}
