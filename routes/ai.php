<?php

use App\Mcp\Servers\WerkbuchServer;

/*
 * The MCP server (phase 13, spec 6.2). laravel/mcp loads this file without a middleware group (no web, no api: no
 * session, no bindings). The middleware of the package (ReorderJsonAccept, ValidateMcpHeaders, AddWwwAuthenticateHeader)
 * comes first on the route Mcp::web() registers, so the door (WerkbuchServer::DOOR) stands as a group around it (K1):
 * the throttle `mcp` before everything, then the language of the account, a bearer token, an active account and a
 * personal access token with `mcp`. GuardMcpRequest (foreign Origin, a body that is no JSON) hangs on the POST route
 * alone: GET and DELETE answer 405. Tests serve their own server at `mcp/_t` the same way.
 */
WerkbuchServer::serve('mcp');
