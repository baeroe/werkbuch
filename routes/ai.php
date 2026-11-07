<?php

use App\Http\Controllers\McpUploadController;
use App\Http\Middleware\AuthenticateUploadUrl;
use App\Http\Middleware\SetLocale;
use App\Mcp\Servers\WerkbuchServer;
use Illuminate\Support\Facades\Route;

/*
 * The MCP server (phase 13, spec 6.2). laravel/mcp loads this file without a middleware group (no web, no api: no
 * session, no bindings). The middleware of the package (ReorderJsonAccept, ValidateMcpHeaders, AddWwwAuthenticateHeader)
 * comes first on the route Mcp::web() registers, so the door (WerkbuchServer::DOOR) stands as a group around it (K1):
 * the throttle `mcp` before everything, then the language of the account, a bearer token, an active account and a
 * personal access token with `mcp`. GuardMcpRequest (foreign Origin, a body that is no JSON) hangs on the POST route
 * alone: GET and DELETE answer 405. Tests serve their own server at `mcp/_t` the same way.
 */
WerkbuchServer::serve('mcp');

/*
 * The upload through an address of `get-upload-url` (IssueUploadUrl, K11): curl posts the file without a bearer token.
 * `signed` is not in the priority list and runs first, so an address with a wrong signature or past its end counts in no
 * throttle (one HMAC); SetLocale goes before the throttle by priority and knows no account there; the throttle
 * `attachments` counts per account like REST (RateKey::account reads the token of the address); then the account of the
 * token. Under /api: refusals are problems; not under /api/v1: no part of the OpenAPI document.
 */
Route::post('api/mcp/uploads/{token}', McpUploadController::class)
    ->middleware(['signed', 'throttle:attachments', AuthenticateUploadUrl::class, SetLocale::class.':'.SetLocale::API])
    ->name('mcp.upload');
