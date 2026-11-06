<?php

use App\Http\Middleware\EnsureAccountIsActive;
use App\Http\Middleware\EnsureMcpToken;
use App\Http\Middleware\GuardMcpRequest;
use App\Http\Middleware\SetLocale;
use App\Http\Middleware\ThrottleApi;
use App\Mcp\Servers\WerkbuchServer;
use Illuminate\Support\Facades\Route;
use Laravel\Mcp\Facades\Mcp;

/*
 * The MCP server (phase 13, spec 6.2). laravel/mcp loads this file without a middleware group (no web, no api: no
 * session, no bindings). The middleware of the package (ReorderJsonAccept, ValidateMcpHeaders, AddWwwAuthenticateHeader)
 * comes first on the route Mcp::web() registers, so the door stands as a group around it (K1): the throttle `mcp` before
 * everything, then the language of the account, a bearer token, an active account and a personal access token with `mcp`.
 * GuardMcpRequest (foreign Origin, a body that is no JSON) hangs on the POST route alone: GET and DELETE answer 405.
 */
Route::middleware([ThrottleApi::class.':mcp', SetLocale::class.':'.SetLocale::API, 'auth:sanctum', EnsureAccountIsActive::class, EnsureMcpToken::class])
    ->group(fn () => Mcp::web('mcp', WerkbuchServer::class)->middleware(GuardMcpRequest::class));
