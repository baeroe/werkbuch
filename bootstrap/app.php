<?php

use App\Exceptions\Problem;
use App\Http\Api\ProblemResponse;
use App\Http\Middleware\TrustProxies;
use App\Support\TrustedRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Middleware\TrustProxies as FrameworkTrustProxies;
use Illuminate\Http\Request;

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
        $middleware->trustHosts(at: fn (): array => TrustedRequests::hostPatterns(config('app.url')), subdomains: false);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // refusals below 500 are expected answers, not errors
        $exceptions->dontReportWhen(fn (Throwable $e): bool => $e instanceof Problem && $e->status < 500);

        // every /api route answers with Problem Details; a response an exception already carries stays as it is
        $exceptions->render(fn (Throwable $e, Request $request) => $request->is('api/*') && ! $e instanceof HttpResponseException
            ? ProblemResponse::from($e, (bool) config('app.debug'))
            : null);

        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
