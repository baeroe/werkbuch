<?php

namespace App\Http\Api;

use App\Exceptions\Problem;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * Renders every exception of an /api route as application/problem+json (RFC 9457):
 * {type: "urn:werkbuch:problem:<reason>", title, status, detail, reason, errors?, ...extensions}.
 * Laravel prepares exceptions before the render callbacks run, so authorization, missing models and CSRF mismatches
 * arrive here as HTTP exceptions (403, 404, 419). 5xx never shows internals unless $debug.
 */
final class ProblemResponse
{
    /** Reason and title slug per HTTP status; every other status is http_error. */
    private const SLUGS = [
        400 => 'bad_request', 401 => 'unauthenticated', 403 => 'forbidden', 404 => 'not_found',
        405 => 'method_not_allowed', 409 => 'conflict', 413 => 'payload_too_large', 419 => 'csrf_token_mismatch',
        422 => 'validation_failed', 429 => 'too_many_requests', 500 => 'server_error', 503 => 'service_unavailable',
    ];

    public static function from(Throwable $e, bool $debug): JsonResponse
    {
        $headers = [];
        $errors = [];
        $extensions = [];
        $own = null;

        switch (true) {
            case $e instanceof Problem:
                [$status, $reason, $own, $errors, $extensions] = [$e->status, $e->reason, $e->detail, $e->errors, $e->extensions];
                break;
            case $e instanceof ValidationException:
                [$status, $reason, $errors] = [422, 'validation_failed', $e->errors()];
                break;
            case $e instanceof AuthenticationException:
                [$status, $reason] = [401, 'unauthenticated'];
                break;
            case $e instanceof HttpExceptionInterface:
                $status = $e->getStatusCode();
                $reason = self::SLUGS[$status] ?? 'http_error';
                $headers = $e->getHeaders();
                break;
            default:
                [$status, $reason] = [500, 'server_error'];
                $own = $debug ? $e->getMessage() : null;
        }

        $body = [
            'type' => 'urn:werkbuch:problem:'.$reason,
            'title' => __('problem.title.'.(self::SLUGS[$status] ?? 'http_error')),
            'status' => $status,
        ];

        // a 404 never explains itself; only a Problem brings its own text, framework messages never reach the body
        // (a crash shows its message only while debugging)
        if ($status !== 404) {
            $body['detail'] = $own ?? __('problem.reason.'.$reason);
        }

        $body['reason'] = $reason;

        if ($errors !== []) {
            $body['errors'] = $errors;
        }

        return new JsonResponse(
            $body + $extensions,
            $status,
            [...$headers, 'Content-Type' => 'application/problem+json'],
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );
    }
}
