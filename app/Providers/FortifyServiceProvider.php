<?php

namespace App\Providers;

use App\Actions\Auth\Authenticate;
use App\Auth\FortifyResetUserPassword;
use App\Auth\PasswordResetLinkResponse;
use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Inertia\Inertia;
use Laravel\Fortify\Actions\AttemptToAuthenticate;
use Laravel\Fortify\Actions\CanonicalizeUsername;
use Laravel\Fortify\Actions\EnsureLoginIsNotThrottled;
use Laravel\Fortify\Actions\PrepareAuthenticatedSession;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse;
use Laravel\Fortify\Fortify;

/**
 * Sign-in, sign-out and password reset through Fortify: its routes, the Inertia pages and the hand-over to the actions.
 */
final class FortifyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(FailedPasswordResetLinkRequestResponse::class, PasswordResetLinkResponse::class);
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
        // before the address is lowered (the lock key lowers it itself)
        Fortify::authenticateThrough(fn () => [
            EnsureLoginIsNotThrottled::class,
            CanonicalizeUsername::class,
            AttemptToAuthenticate::class,
            PrepareAuthenticatedSession::class,
        ]);

        Fortify::resetUserPasswordsUsing(FortifyResetUserPassword::class);

        // the limit per IP over all addresses; bootstrap/app.php shows its 429 as an error at the email field
        RateLimiter::for('login', fn (Request $request) => Limit::perMinute((int) config('werkbuch.rate_limits.login_per_ip'))->by((string) $request->ip()));

        // the link always points to APP_URL: a forged Host header must not lead the mail elsewhere
        ResetPassword::createUrlUsing(fn (User $user, string $token) => rtrim((string) config('app.url'), '/').'/reset-password/'.$token.'?email='.urlencode((string) $user->email));
    }
}
