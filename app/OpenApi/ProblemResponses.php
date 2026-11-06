<?php

namespace App\OpenApi;

use App\Http\Middleware\EnsureTokenAbility;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Components as Registry;
use Dedoc\Scramble\Support\Generator\Header;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Reference;
use Dedoc\Scramble\Support\Generator\Response;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\Types\IntegerType;
use Dedoc\Scramble\Support\Generator\Types\StringType;
use Dedoc\Scramble\Support\RouteInfo;

/**
 * The answers of an operation besides its success (A385: documented means “can happen”). Every error is a Problem
 * (`$ref: '#/components/responses/Problem<status>'`, `application/problem+json`): the shapes Scramble infers from
 * Laravel's exceptions (`{message}` as `application/json`) are replaced, never kept (K1).
 *
 * - every operation: 401, 403, 404, 422, 429 (with `Retry-After`), 500, 503 (a service it needs can be down, K14);
 * - with a body (every method but `GET`): 413 and 419 (the CSRF token of the session);
 * - writing (`x-werkbuch-ability` `write`): 409;
 * - a `GET` with `{item}`: 301 to the current key (`RedirectFormerItemKey`);
 * - every 2xx: the headers of the rate limit.
 */
final class ProblemResponses extends OperationExtension
{
    /** What each status of a problem means here. */
    public const STATUSES = [
        401 => 'Not signed in: no session and no valid token (`unauthenticated`).',
        403 => 'Not allowed: the account or the token may not do this (`forbidden`, `session_required`, …; `detail` says why).',
        404 => 'Not found, or not visible to the account: what it may not see is always 404, never 403.',
        409 => 'The current state does not allow it (`reason` names the conflict, e.g. `archived`, `description_conflict`).',
        413 => 'The body is too large (`payload_too_large`).',
        419 => 'The CSRF token of the session is missing or stale (`csrf_token_mismatch`; session only).',
        422 => 'Invalid input (`validation_failed` or a reason of its own): `errors` names the fields.',
        429 => 'Too many requests (`too_many_requests`): `Retry-After` says when to try again.',
        500 => 'An error of the server (`server_error`).',
        503 => 'A service the request needs is unavailable (`search_unavailable`, `mail_failed`, …).',
    ];

    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        $method = strtoupper($routeInfo->method);
        $statuses = [401, 403, 404, 422, 429, 500, 503];
        if ($method !== 'GET') {
            $statuses = [...$statuses, 413, 419];
        }
        if (EnsureTokenAbility::required($routeInfo->route, $method) === 'write') {
            $statuses[] = 409;
        }
        sort($statuses);

        $registry = $this->openApiTransformer->getComponents();
        $kept = [];
        foreach ($operation->responses ?? [] as $response) {
            // a reference names a response of the registry (a resource answer Scramble shares between operations)
            $resolved = $response instanceof Reference ? $response->resolve() : $response;
            $code = is_numeric($resolved->code) ? (int) $resolved->code : null;
            if ($code !== null && $code >= 400) {
                continue;
            }
            if ($code !== null && $code < 300) {
                $resolved->addHeader('X-RateLimit-Limit', self::header('The requests allowed per minute.', new IntegerType));
                $resolved->addHeader('X-RateLimit-Remaining', self::header('The requests left in this minute.', new IntegerType));
            }
            $kept[] = $response;
        }

        if ($method === 'GET' && in_array('item', $routeInfo->route->parameterNames(), true)) {
            $kept[] = Response::make(301)
                ->setDescription('The item was asked for by a former key: `Location` names the same route with its current key.')
                ->addHeader('Location', self::header('The same route with the current key, with the query.', new StringType));
        }

        $operation->responses = [...$kept, ...array_map(fn (int $status) => self::reference($registry, $status), $statuses)];
    }

    /**
     * The response `Problem<status>` in the registry of the document, added the first time it is asked for.
     */
    public static function reference(Registry $registry, int $status): Reference
    {
        $reference = new Reference('responses', 'Problem'.$status, $registry);

        return $registry->has($reference) ? $reference : $registry->add($reference, self::response($registry, $status));
    }

    /**
     * The problem answer of a status, its body the schema `Problem` (`Components`).
     */
    public static function response(Registry $registry, int $status): Response
    {
        $response = Response::make($status)
            ->setDescription(self::STATUSES[$status] ?? 'An error.')
            ->setContent('application/problem+json', new Reference('schemas', 'Problem', $registry));

        if ($status === 429) {
            $response->addHeader('Retry-After', self::header('The seconds to wait before the next request.', new IntegerType));
        }

        return $response;
    }

    private static function header(string $description, IntegerType|StringType $type): Header
    {
        return new Header(description: $description, schema: Schema::fromType($type));
    }
}
