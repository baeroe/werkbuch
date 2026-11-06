<?php

use Tests\Feature\Access\MatrixWorld;

/*
 * The tool matrix (McpToolMatrixTest, McpParityTest, McpSchemasTest): every action of every tool of the MCP server as
 * `tool:action`, once (a guard keeps the rows in sync with the tools). A row brings the arguments of its call from the
 * MatrixWorld, as tests/Feature/Api/routes.php brings those of the twin: `'arguments' => fn (MatrixWorld $w) =>
 * ['item' => $w->item('project_admin')->key]`. A tool with several actions gets `action` from the key. Rows of lists
 * with `lean` and all rows the parity test reads set `per_page` and `lean` themselves (K8), so the call over REST reads
 * the same page.
 */

return [
    'whoami:call' => [],
    // the key of an item of the world: a key match also without an index (feature tests search no engine)
    'search:call' => ['arguments' => fn (MatrixWorld $w) => [
        'q' => $w->item('project_admin')->key, 'types' => ['items', 'projects'], 'limit' => 5, 'include_archived' => 1,
        'state_category' => ['backlog', 'started'], 'assignee_id' => ['none'],
    ]],
];
