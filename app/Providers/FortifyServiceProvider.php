<?php

namespace App\Providers;

use App\Actions\Auth\Authenticate;
use App\Auth\FortifyResetUserPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Inertia\Inertia;
use Laravel\Fortify\Actions\AttemptToAuthenticate;
use Laravel\Fortify\Actions\CanonicalizeUsername;
use Laravel\Fortify\Actions\EnsureLoginIsNotThrottled;
use Laravel\Fortify\Actions\PrepareAuthenticatedSession;
use Laravel\Fortify\Fortify;

/**
 * Sign-in, sign-out and password reset through Fortify: the Inertia pages, the limits and the hand-over to the actions.
 * The routes are in routes/auth.php; POST /forgot-password and POST /reset-password are werkbuch's own (App\Http\Controllers\Auth).
 */
final class FortifyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Fortify's route file would also register password confirmation (/user/confirm-password), which werkbuch does
        // not offer; routes/auth.php registers the routes werkbuch uses
        Fortify::ignoreRoutes();
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
        // before the address is lowered (the lock key lowers it itself). Two-factor sign-in (Phase 2) has to add
        // RedirectsIfTwoFactorAuthenticatable before AttemptToAuthenticate here, the default pipeline no longer applies.
        Fortify::authenticateThrough(fn () => [
            EnsureLoginIsNotThrottled::class,
            CanonicalizeUsername::class,
            AttemptToAuthenticate::class,
            PrepareAuthenticatedSession::class,
        ]);

        Fortify::resetUserPasswordsUsing(FortifyResetUserPassword::class);

        // the limits per IP over all addresses (each its own budget); App\Exceptions\Rendering shows their 429 as an error at the email field (accepting an invitation: at the invitation)
        RateLimiter::for('login', fn (Request $request) => Limit::perMinute((int) config('werkbuch.rate_limits.login_per_ip'))->by((string) $request->ip()));
        RateLimiter::for('password-reset', fn (Request $request) => Limit::perMinute((int) config('werkbuch.rate_limits.password_reset_per_ip'))->by((string) $request->ip()));
        RateLimiter::for('password-update', fn (Request $request) => Limit::perMinute((int) config('werkbuch.rate_limits.password_update_per_ip'))->by((string) $request->ip()));
        RateLimiter::for('invitation', fn (Request $request) => Limit::perMinute((int) config('werkbuch.rate_limits.invitation_accept_per_ip'))->by((string) $request->ip()));
    }
}
