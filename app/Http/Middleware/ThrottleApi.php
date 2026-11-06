<?php

namespace App\Http\Middleware;

use Illuminate\Routing\Middleware\ThrottleRequests;
use Symfony\Component\HttpFoundation\Response;

/**
 * The throttle of the group `api` (limiter `api`, A387): Laravel's, except that its `X-RateLimit-*` headers always win.
 * Laravel keeps the headers of an inner throttle with fewer requests left (`throttle:attachments`, `throttle:6,1`), so
 * a client would read the limit of a route as the limit of the API. Here `X-RateLimit-Limit` and `-Remaining` are always
 * the API's; which throttle refused says only `Retry-After` (K9, P2), the inner `X-RateLimit-Reset` goes with the inner
 * headers. Its own refusal (429) carries the headers Laravel gives it.
 */
final class ThrottleApi extends ThrottleRequests
{
    /**
     * @param  int  $maxAttempts
     * @param  int  $remainingAttempts
     * @param  int|null  $retryAfter
     */
    protected function addHeaders(Response $response, $maxAttempts, $remainingAttempts, $retryAfter = null)
    {
        $response->headers->remove('X-RateLimit-Reset');
        $response->headers->add(['X-RateLimit-Limit' => $maxAttempts, 'X-RateLimit-Remaining' => $remainingAttempts]);

        return $response;
    }
}
