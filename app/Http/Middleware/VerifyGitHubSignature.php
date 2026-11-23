<?php

namespace App\Http\Middleware;

use App\Domain\GitHub\WebhookSignature;
use App\Exceptions\Problem;
use App\Http\Api\RateKey;
use App\Models\GitHubApp;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * The webhook of GitHub takes only deliveries signed with the secret of the app (spec 11.4): `X-Hub-Signature-256` over
 * the raw body. Without an app, without the header or with another signature: a 401 problem, nothing kept. Only unsigned
 * requests count against their address (`UNSIGNED_PER_MINUTE`, then 429): GitHub itself is never throttled (A517). A
 * body over `MAX_BYTES` (GitHub sends at most 25 MB) is a 413 before it is read.
 */
final class VerifyGitHubSignature
{
    public const PATH = 'github/webhook';

    public const MAX_BYTES = 25 * 1024 * 1024;

    public const UNSIGNED_PER_MINUTE = 60;

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws AuthenticationException
     * @throws ThrottleRequestsException
     * @throws Problem 413
     */
    public function handle(Request $request, Closure $next): Response
    {
        if ((int) $request->header('Content-Length', '0') > self::MAX_BYTES) {
            throw Problem::tooLarge(__('problem.detail.github_too_large'));
        }

        $app = GitHubApp::current();
        if ($app !== null && WebhookSignature::matches($app->webhook_secret, $request->getContent(), $request->header('X-Hub-Signature-256'))) {
            return $next($request);
        }

        $key = 'github-unsigned:'.RateKey::IP.$request->ip();
        if (RateLimiter::tooManyAttempts($key, self::UNSIGNED_PER_MINUTE)) {
            throw new ThrottleRequestsException(headers: ['Retry-After' => RateLimiter::availableIn($key)]);
        }
        RateLimiter::hit($key, 60);

        throw new AuthenticationException;
    }
}
