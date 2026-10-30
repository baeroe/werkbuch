<?php

namespace App\Exceptions;

use App\Http\Api\ProblemResponse;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * How exceptions become answers: Problem Details under /api, Inertia error pages in the browser app. Lives in app/ so the
 * coverage (PCOV measures app/ only) sees it; bootstrap/app.php only calls register().
 */
final class Rendering
{
    public static function register(Exceptions $exceptions): void
    {
        // refusals below 500 are expected answers, not errors
        $exceptions->dontReportWhen(fn (Throwable $e): bool => $e instanceof Problem && $e->status < 500);

        // every /api route answers with Problem Details; a response an exception already carries stays as it is
        $exceptions->render(fn (Throwable $e, Request $request) => $request->is('api/*') && ! $e instanceof HttpResponseException
            ? ProblemResponse::from($e, (bool) config('app.debug'))
            : null);

        // the limits per IP of the sign-in, of the reset links and of the new passwords show at the email field (like the
        // lock per address), instead of a 429 page
        $exceptions->render(fn (ThrottleRequestsException $e, Request $request) => $request->routeIs('login.store', 'password.email', 'password.update')
            ? back()->withErrors(['email' => __('auth.throttle', ['seconds' => (int) ($e->getHeaders()['Retry-After'] ?? 60)])])->onlyInput('email')
            : null);

        // accepting an invitation: the limit shows at the page's own error, which also names a link that no longer works
        $exceptions->render(fn (ThrottleRequestsException $e, Request $request) => $request->routeIs('invitations.accept')
            ? back()->withErrors(['invitation' => __('auth.throttle', ['seconds' => (int) ($e->getHeaders()['Retry-After'] ?? 60)])])
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
    }
}
