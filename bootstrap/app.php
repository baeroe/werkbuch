<?php

use App\Exceptions\Rendering;
use App\Http\Middleware\ConvertEmptyStringsToNull;
use App\Http\Middleware\EnsureAccountIsActive;
use App\Http\Middleware\EnsureSession;
use App\Http\Middleware\EnsureTokenAbility;
use App\Http\Middleware\GuardChannelAuthorization;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\LimitJsonBody;
use App\Http\Middleware\SetLocale;
use App\Http\Middleware\ThrottleApi;
use App\Http\Middleware\TrustProxies;
use App\RichText\RichTextInput;
use App\Support\TrustedRequests;
use Illuminate\Auth\Middleware\Authorize;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Contracts\Session\Middleware\AuthenticatesSessions;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull as FrameworkConvertEmptyStringsToNull;
use Illuminate\Foundation\Http\Middleware\HandlePrecognitiveRequests;
use Illuminate\Foundation\Http\Middleware\InvokeDeferredCallbacks;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Foundation\Http\Middleware\PreventRequestsDuringMaintenance;
use Illuminate\Foundation\Http\Middleware\TrimStrings;
use Illuminate\Http\Middleware\HandleCors;
use Illuminate\Http\Middleware\TrustHosts;
use Illuminate\Http\Middleware\TrustProxies as FrameworkTrustProxies;
use Illuminate\Http\Middleware\ValidatePathEncoding;
use Illuminate\Http\Middleware\ValidatePostSize;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Routing\Middleware\ThrottleRequestsWithRedis;
use Illuminate\Session\Middleware\AuthenticateSession;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api/v1',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    // the channels (routes/channels.php) authorize through /broadcasting/auth: a signed-in, active account (spec 7.2)
    ->withBroadcasting(__DIR__.'/../routes/channels.php', ['middleware' => ['web', 'auth', EnsureAccountIsActive::class, GuardChannelAuthorization::class]])
    ->withMiddleware(function (Middleware $middleware): void {
        // Laravel's global stack with the limit of a JSON body under /api after the CORS headers (a client of another
        // origin reads the 413) and before PHP's limit and the trimming of the input (A388, K8)
        $middleware->use([
            ValidatePathEncoding::class,
            InvokeDeferredCallbacks::class,
            TrustHosts::class,
            FrameworkTrustProxies::class,
            HandleCors::class,
            PreventRequestsDuringMaintenance::class,
            LimitJsonBody::class,
            ValidatePostSize::class,
            TrimStrings::class,
            FrameworkConvertEmptyStringsToNull::class,
        ]);
        // reverse proxy in front: X-Forwarded-* only from TRUSTED_PROXIES (default: localhost and private networks);
        // the Host header must be the host of APP_URL (outside local and tests)
        $middleware->replace(FrameworkTrustProxies::class, TrustProxies::class);
        // rich text keeps its spaces: a text node of " " between two marks is content (RichTextInput::RAW_KEYS)
        $middleware->trimStrings(except: RichTextInput::RAW_KEYS);
        $middleware->replace(FrameworkConvertEmptyStringsToNull::class, ConvertEmptyStringsToNull::class);
        // the language comes before Inertia, so Inertia shares the translations of the language the request speaks;
        // the locale cookie is plain (HttpOnly, but not encrypted): the server reads it for guests, so the login page speaks
        // the language of the last session
        // a session ends on its next request when the password changed (AuthenticateSession compares the hash, any session
        // driver) or the account was disabled (EnsureAccountIsActive)
        $middleware->web(append: [SetLocale::class, HandleInertiaRequests::class, AuthenticateSession::class, EnsureAccountIsActive::class]);
        // the API speaks the language of the account (session or token), else the organization's (A151); its throttle
        // (limiter `api`, per token, else account of the session, else address, A387) runs before auth (priority below)
        $middleware->api(append: [SetLocale::class.':'.SetLocale::API, ThrottleApi::class.':api']);
        $middleware->encryptCookies(except: [SetLocale::COOKIE]);
        $middleware->trustHosts(at: fn (): array => TrustedRequests::hostPatterns(config('app.url')), subdomains: false);
        // Laravel's priority list with the rate limit moved before auth (requests that fail auth count as well), and the
        // language right after the session: the refusals of CSRF (419) and of the rate limit (429) speak it already; what a
        // token may do is checked once it is known who sends it (the session check of /me/* goes before it, P28)
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
            EnsureSession::class,
            EnsureTokenAbility::class,
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
