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
 * The webhook of GitHub takes only deliveries signed with the secret of the app that sends them (spec 11.4, A680): one
 * address for every app, the app named by `X-GitHub-Hook-Installation-Target-ID` (its ID at GitHub), the signature
 * `X-Hub-Signature-256` over the raw body with that app's secret. Without the header or with an app werkbuch does not
 * know, without the signature or with another one: a 401 problem, nothing kept. The app goes on to the controller as the
 * attribute `github_app`. Only unsigned
 * requests count against their address (`UNSIGNED_PER_MINUTE`, then 429 before the body is read or the HMAC computed):
 * GitHub itself is never counted (A517). A body over `MAX_BYTES` (GitHub sends at most 25 MB) is a 413: by its
 * `Content-Length` before it is read, without one (chunked) as soon as more than that came.
 */
final class VerifyGitHubSignature
{
    public const PATH = 'github/webhook';

    public const MAX_BYTES = 25 * 1024 * 1024;

    public const UNSIGNED_PER_MINUTE = 60;

    /** The request attribute that carries the app of a signed delivery. */
    public const APP = 'github_app';

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws AuthenticationException
     * @throws ThrottleRequestsException
     * @throws Problem 413
     */
    public function handle(Request $request, Closure $next): Response
    {
        $length = $request->headers->get('Content-Length');
        if (is_numeric($length) && (int) $length > self::MAX_BYTES) {
            throw Problem::tooLarge(__('problem.detail.github_too_large'));
        }

        // an address that sent too many unsigned requests is refused before werkbuch reads the body or computes the HMAC
        $key = 'github-unsigned:'.RateKey::IP.$request->ip();
        if (RateLimiter::tooManyAttempts($key, self::UNSIGNED_PER_MINUTE)) {
            throw new ThrottleRequestsException(headers: ['Retry-After' => RateLimiter::availableIn($key)]);
        }

        // without Content-Length (chunked) or when it lies: at most MAX_BYTES + 1 bytes are read, never further
        $body = stream_get_contents($request->getContent(true), self::MAX_BYTES + 1);
        if (! is_string($body) || strlen($body) > self::MAX_BYTES) {
            throw Problem::tooLarge(__('problem.detail.github_too_large'));
        }

        $target = $request->header('X-GitHub-Hook-Installation-Target-ID');
        $app = is_string($target) && preg_match('/^[1-9][0-9]{0,18}\z/', $target) === 1
            ? GitHubApp::query()->where('app_id', (int) $target)->first()
            : null;
        if ($app !== null && WebhookSignature::matches($app->webhook_secret, $body, $request->header('X-Hub-Signature-256'))) {
            $request->attributes->set(self::APP, $app);

            return $next($request);
        }

        RateLimiter::hit($key, 60);

        throw new AuthenticationException;
    }
}
