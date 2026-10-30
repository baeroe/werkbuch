<?php

use App\Exceptions\Problem;
use App\Http\Api\ProblemResponse;
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
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Middleware\TrustProxies as FrameworkTrustProxies;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Routing\Middleware\ThrottleRequestsWithRedis;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

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
            ThrottleRequests::class,
            ThrottleRequestsWithRedis::class,
            AuthenticatesRequests::class,
            AuthenticatesSessions::class,
            SubstituteBindings::class,
            Authorize::class,
        ]);
        $middleware->redirectGuestsTo(fn () => route('login'));
        $middleware->redirectUsersTo('/my-items');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // refusals below 500 are expected answers, not errors
        $exceptions->dontReportWhen(fn (Throwable $e): bool => $e instanceof Problem && $e->status < 500);

        // every /api route answers with Problem Details; a response an exception already carries stays as it is
        $exceptions->render(fn (Throwable $e, Request $request) => $request->is('api/*') && ! $e instanceof HttpResponseException
            ? ProblemResponse::from($e, (bool) config('app.debug'))
            : null);

        // the limits per IP of the sign-in and of the reset links show at the email field (like the lock per address),
        // instead of a 429 page
        $exceptions->render(fn (ThrottleRequestsException $e, Request $request) => $request->routeIs('login.store', 'password.email')
            ? back()->withErrors(['email' => __('auth.throttle', ['seconds' => (int) ($e->getHeaders()['Retry-After'] ?? 60)])])->onlyInput('email')
            : null);

        // an expired session (CSRF token mismatch; Laravel has already turned it into a 419) leads back with a message:
        // guests to the sign-in (the page they came from would send them there and lose the message), signed-in people
        // to the page they came from
        $exceptions->render(fn (HttpExceptionInterface $e, Request $request) => $e->getStatusCode() === 419 && ! $request->is('api/*')
            ? ($request->user() === null ? redirect()->route('login', status: 303) : redirect()->back(303))->with('error', __('errors.page_expired'))
            : null);

        // the browser app shows a refusal (403), an unknown page (404), a failure (500) and an outage (503) as an Inertia page
        // in the shell (the status stays); /api keeps its problem documents, and in debug mode a 500 stays Laravel's own page.
        // Where the web group did not run (maintenance mode, an untrusted host), the page would lack its shared props:
        // Laravel's own page stays.
        $exceptions->respond(function (Response $response, Throwable $e, Request $request) {
            $status = $response->getStatusCode();

            if ($request->is('api/*')
                || ! in_array($status, [403, 404, 500, 503], true)
                || ($status === 500 && config('app.debug'))
                || Inertia::getShared('locale') === null) {
                return $response;
            }

            return Inertia::render($status === 404 ? 'Errors/NotFound' : 'Errors/Error', ['status' => $status])
                ->toResponse($request)->setStatusCode($status);
        });

        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
