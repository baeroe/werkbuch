<?php

namespace App\Http\Middleware;

use App\Domain\GitHub\WebhookSignature;
use App\Models\GitHubApp;
use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The webhook of GitHub takes only deliveries signed with the secret of the app (spec 11.4): `X-Hub-Signature-256` over
 * the raw body. Without an app, without the header or with another signature: a 401 problem, nothing kept.
 */
final class VerifyGitHubSignature
{
    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws AuthenticationException
     */
    public function handle(Request $request, Closure $next): Response
    {
        $app = GitHubApp::current();

        if ($app === null || ! WebhookSignature::matches($app->webhook_secret, $request->getContent(), $request->header('X-Hub-Signature-256'))) {
            throw new AuthenticationException;
        }

        return $next($request);
    }
}
