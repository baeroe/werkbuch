<?php

namespace App\Http\Api;

use Illuminate\Http\Request;

/**
 * The paths that answer refusals as problem documents (application/problem+json) instead of pages: the REST API under
 * /api and the MCP server at /mcp (`mcp/*` for a server a test registers there, `mcp/_t`). The rendering of exceptions,
 * the end of a deactivated account and the limit of a JSON body ask only this.
 */
final class ApiPaths
{
    public static function problems(Request $request): bool
    {
        return $request->is('api/*', 'mcp', 'mcp/*');
    }
}
