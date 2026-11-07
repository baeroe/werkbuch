<?php

namespace App\Http\Middleware;

use App\Exceptions\Problem;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The POST route of /mcp (K15): a request a browser sends from another origin is refused (the MCP specification asks
 * servers to check `Origin`, against DNS rebinding); a client without a browser sends none and passes. The body must be
 * JSON: only then do TrimStrings and ConvertEmptyStringsToNull clean the arguments of a tool as they clean a REST body
 * (A149), so a body of another type is refused with 415.
 */
final class GuardMcpRequest
{
    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws Problem 403 for a foreign origin, 415 for a body that is no JSON
     */
    public function handle(Request $request, Closure $next): Response
    {
        $origin = $request->headers->get('Origin');

        if ($origin !== null && $origin !== self::ownOrigin()) {
            throw Problem::forbidden(__('problem.detail.mcp_origin'));
        }

        if (! $request->isJson()) {
            throw Problem::unsupportedMediaType();
        }

        return $next($request);
    }

    /**
     * `scheme://host[:port]` of APP_URL, the form a browser sends in `Origin`: the default port of the scheme (80 for
     * http, 443 for https) is no part of it, a browser never names it.
     */
    private static function ownOrigin(): string
    {
        $url = parse_url((string) config('app.url'));
        $scheme = strtolower((string) ($url['scheme'] ?? ''));
        $host = strtolower((string) ($url['host'] ?? ''));
        $default = ['http' => 80, 'https' => 443][$scheme] ?? null;
        $port = isset($url['port']) && $url['port'] !== $default ? ':'.$url['port'] : '';

        return $scheme.'://'.$host.$port;
    }
}
