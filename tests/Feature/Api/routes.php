<?php

/*
 * The route matrix (RouteMatrixTest): every route below /api/v1 with its method and URI, the URI with the placeholders
 * of the route ({user}, {token}, …). A row with placeholders brings their values from the MatrixWorld:
 * `'params' => fn (MatrixWorld $w) => ['user' => $w->target->id]`; a placeholder without a value fails the test. Rows
 * with `'session' => true` only work from the session of the interface (P6): every token gets 403 session_required.
 */

return [
    'show organization' => ['GET', '/api/v1/organization'],
    'change organization' => ['PATCH', '/api/v1/organization'],
];
