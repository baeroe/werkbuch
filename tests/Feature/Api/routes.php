<?php

use Tests\Feature\Access\MatrixWorld;

/*
 * The route matrix (RouteMatrixTest): every route below /api/v1 with its method and URI, the URI with the placeholders
 * of the route ({user}, {token}, …). A row with placeholders brings their values from the MatrixWorld:
 * `'params' => fn (MatrixWorld $w) => ['user' => $w->target->id]`; a placeholder without a value fails the test. Rows
 * with `'session' => true` only work from the session of the interface (P6): every token gets 403 session_required.
 */

return [
    'show organization' => ['GET', '/api/v1/organization'],
    'change organization' => ['PATCH', '/api/v1/organization'],
    'list accounts' => ['GET', '/api/v1/users'],
    'change an account' => ['PATCH', '/api/v1/users/{user}', 'params' => fn (MatrixWorld $w) => ['user' => $w->target->id]],
    'set the role of an account' => ['PUT', '/api/v1/users/{user}/role', 'params' => fn (MatrixWorld $w) => ['user' => $w->target->id]],
    'deactivate an account' => ['POST', '/api/v1/users/{user}/deactivate', 'params' => fn (MatrixWorld $w) => ['user' => $w->target->id]],
    'reactivate an account' => ['POST', '/api/v1/users/{user}/reactivate', 'params' => fn (MatrixWorld $w) => ['user' => $w->target->id]],
    'list bots' => ['GET', '/api/v1/bots'],
    'create a bot' => ['POST', '/api/v1/bots'],
    'list invitations' => ['GET', '/api/v1/invitations'],
    'invite a person' => ['POST', '/api/v1/invitations'],
    'list tokens' => ['GET', '/api/v1/tokens'],
    'create a token' => ['POST', '/api/v1/tokens'],
    'revoke a token' => ['DELETE', '/api/v1/tokens/{token}', 'params' => fn (MatrixWorld $w) => ['token' => $w->bot->createToken('Matrix', ['read'])->accessToken->id]],
    'change the own password' => ['PUT', '/api/v1/me/password', 'session' => true],
    'show the own second factor' => ['GET', '/api/v1/me/two-factor', 'session' => true],
    'start the setup of the second factor' => ['POST', '/api/v1/me/two-factor', 'session' => true],
    'confirm the second factor' => ['POST', '/api/v1/me/two-factor/confirm', 'session' => true],
    'turn the second factor off' => ['DELETE', '/api/v1/me/two-factor', 'session' => true],
    'make new recovery codes' => ['POST', '/api/v1/me/two-factor/recovery-codes', 'session' => true],
];
