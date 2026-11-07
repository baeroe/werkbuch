<?php

use Tests\Feature\Access\MatrixWorld;

/*
 * The rows of the twin server (TwinServer), in the form of tests/Feature/Mcp/tools.php: every action of its tools once,
 * lists and reads with `per_page` and `lean` set.
 */

return [
    'twins:list-users' => ['arguments' => fn (MatrixWorld $w) => ['filter' => ['type' => ['person', 'bot']], 'sort' => '-type', 'per_page' => 5]],
    'twins:members' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier, 'per_page' => 5]],
    'twins:query' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['lean' => false, 'per_page' => 5]]],
    'twins:groups' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['group_by' => 'priority']]],
    'manage-twins:create-view' => ['arguments' => fn (MatrixWorld $w) => ['input' => [
        'name' => 'Matrix', 'icon' => 'layers', 'filter' => ['version' => 1, 'conditions' => []],
        'display' => ['layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'rank', 'direction' => 'asc'], 'fields' => ['key', 'title'], 'show_sub_items' => true],
    ]]],
    'manage-twins:create-label' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['name' => 'Matrix', 'color' => 'sky']]],
    'manage-twins:delete-view' => ['arguments' => fn (MatrixWorld $w) => ['view' => $w->view()->id]],
];
