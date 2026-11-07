<?php

namespace App\Mcp\Support;

use Illuminate\Contracts\Debug\ExceptionHandler;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use stdClass;
use Throwable;

/**
 * An exception in a tool as the result of the call (K5): reported and rendered the way REST does it, through Laravel's
 * exception handler. `report()` keeps to `dontReport` (no report for a problem below 500 nor for `search_unavailable`,
 * `mail_failed`, `webhook_not_logged`, nor for the exceptions Laravel never reports), `render()` gives the problem
 * document of `ApiPaths` (Laravel turns a `ModelNotFoundException` into 404 and an `AuthorizationException` into 403 on
 * the way, as over REST; a crash shows no message unless debugging).
 *
 * The result is an error (`isError`) with a line `<status> <reason>: <detail or title>` and a line per field error
 * (`<path>: <sentence>`), and the problem as `structuredContent` (with `retry_after` from `Retry-After` on a 429).
 */
final class McpProblem
{
    public static function response(Throwable $e): ResponseFactory
    {
        $handler = app(ExceptionHandler::class);
        $handler->report($e);
        $response = $handler->render(request(), $e);

        /** @var stdClass&object{status: int, reason: string, title: string, detail?: string, errors?: stdClass} $body */
        $body = json_decode((string) $response->getContent(), flags: JSON_THROW_ON_ERROR);

        $retry = $response->headers->get('Retry-After');
        if ($response->getStatusCode() === 429 && is_numeric($retry)) {
            $body->retry_after = (int) $retry;
        }

        $lines = [sprintf('%d %s: %s', $body->status, $body->reason, $body->detail ?? $body->title)];
        foreach ((array) ($body->errors ?? []) as $path => $sentences) {
            foreach ((array) $sentences as $sentence) {
                $lines[] = $path.': '.$sentence;
            }
        }

        return Response::make(Response::error(implode("\n", $lines)))->withStructuredContent((array) Output::markdown($body));
    }
}
