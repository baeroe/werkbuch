<?php

use App\Exceptions\Rendering;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\SetLocale;
use App\Http\Middleware\TrustProxies;
use App\Support\TrustedRequests;
use Illuminate\Auth\Middleware\Authorize;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Contracts\Session\Middleware\AuthenticatesSessions;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\HandlePrecognitiveRequests;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Http\Middleware\TrustProxies as FrameworkTrustProxies;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Routing\Middleware\ThrottleRequestsWithRedis;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api/v1',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // reverse proxy in front: X-Forwarded-* only from TRUSTED_PROXIES (default: localhost and private networks);
        // the Host header must be the host of APP_URL (outside local and tests)
        $middleware->replace(FrameworkTrustProxies::class, TrustProxies::class);
        // the language comes before Inertia, so Inertia shares the translations of the language the request speaks;
        // the locale cookie is plain (HttpOnly, but not encrypted): the server reads it for guests, so the login page speaks
        // the language of the last session
        $middleware->web(append: [SetLocale::class, HandleInertiaRequests::class]);
        $middleware->encryptCookies(except: [SetLocale::COOKIE]);
        $middleware->trustHosts(at: fn (): array => TrustedRequests::hostPatterns(config('app.url')), subdomains: false);
        // Laravel's priority list with the rate limit moved before auth (requests that fail auth count as well), and the
        // language right after the session: the refusals of CSRF (419) and of the rate limit (429) speak it already
        $middleware->priority([
            HandlePrecognitiveRequests::class,
            EncryptCookies::class,
            AddQueuedCookiesToResponse::class,
            StartSession::class,
            ShareErrorsFromSession::class,
            SetLocale::class,
            PreventRequestForgery::class,
            HandleInertiaRequests::class,
            ThrottleRequests::class,
            ThrottleRequestsWithRedis::class,
            AuthenticatesRequests::class,
            AuthenticatesSessions::class,
            SubstituteBindings::class,
            Authorize::class,
        ]);
        $middleware->statefulApi();
        $middleware->redirectGuestsTo(fn () => route('login'));
        $middleware->redirectUsersTo('/my-items');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        Rendering::register($exceptions);
    })->create();
