<?php

namespace App\Http\Middleware;

use App\Exceptions\Problem;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * At most MAX_BYTES of JSON (or any other body that is no form) under /api (A388, K8): a global middleware after the
 * CORS headers and before ValidatePostSize and TrimStrings, so a body above the limit is a 413 `payload_too_large` with
 * its own sentence before the app reads the input. 8 MiB: a picture as a data URL (2 MiB decoded, about 2.7 MiB in JSON)
 * and an item with a description and a dozen rich text values at their limit fit.
 *
 * `Content-Length` decides at once; without it (chunked) or when it lies, the body is read up to MAX_BYTES + 1 bytes,
 * never further. Laravel itself decodes a body it takes for JSON when it captures the request (Request::createFromBase),
 * so the memory of a huge JSON body is the web server's limit to keep (Phase 14); this keeps it from the app. Uploads
 * (`multipart/form-data`) have their limit of their own (ATTACHMENTS_MAX_MB), forms PHP's `post_max_size`.
 */
final class LimitJsonBody
{
    public const MAX_BYTES = 8 * 1024 * 1024;

    private const FORMS = ['multipart/form-data', 'application/x-www-form-urlencoded'];

    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->is('api/*') || $this->isForm($request)) {
            return $next($request);
        }

        $length = $request->headers->get('Content-Length');

        if ((is_numeric($length) && (int) $length > self::MAX_BYTES) || $this->exceeds($request)) {
            throw Problem::tooLarge(__('problem.detail.json_too_large', ['max' => self::MAX_BYTES / 1024 / 1024]));
        }

        return $next($request);
    }

    private function isForm(Request $request): bool
    {
        $type = strtolower(trim(explode(';', (string) $request->headers->get('Content-Type'))[0]));

        return in_array($type, self::FORMS, true);
    }

    /** Reads at most MAX_BYTES + 1 bytes of the body, never all of it (php://input of a chunked request). */
    private function exceeds(Request $request): bool
    {
        $stream = $request->getContent(true);
        $read = stream_get_contents($stream, self::MAX_BYTES + 1);

        return is_string($read) && strlen($read) > self::MAX_BYTES;
    }
}
