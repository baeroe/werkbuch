<?php

use App\Models\Label;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\Workflow;
use App\Models\WorkItemRelation;
use App\Models\WorkItemType;
use Tests\Feature\Access\MatrixWorld;
use Tests\Support\WorkflowFixtures;

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
    'get-upload-url:call' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['project_id' => $w->web->identifier, 'kind' => 'inline']]],
    'organization:get' => [],
    'organization:state-usage' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'organization:list-workflows' => ['arguments' => fn (MatrixWorld $w) => ['filter' => ['name' => 'a'], 'sort' => 'name', 'per_page' => 5]],
    'organization:get-workflow' => ['arguments' => fn (MatrixWorld $w) => ['id' => Workflow::default()->id]],
    'organization:list-types' => ['arguments' => fn (MatrixWorld $w) => ['sort' => 'name', 'per_page' => 5]],
    'organization:get-type' => ['arguments' => fn (MatrixWorld $w) => ['id' => WorkItemType::factory()->create()->id]],
    'organization:list-properties' => ['arguments' => fn (MatrixWorld $w) => ['sort' => 'label', 'per_page' => 5]],
    'organization:get-property' => ['arguments' => fn (MatrixWorld $w) => ['id' => Property::factory()->create()->id]],
    'organization:list-labels' => ['arguments' => fn (MatrixWorld $w) => ['filter' => ['name' => 'a'], 'per_page' => 5]],
    'organization:get-label' => ['arguments' => fn (MatrixWorld $w) => ['id' => Label::factory()->create()->id]],
    'organization:list-relation-types' => ['arguments' => fn (MatrixWorld $w) => ['per_page' => 5]],
    'organization:get-relation-type' => ['arguments' => fn (MatrixWorld $w) => ['id' => RelationType::factory()->create()->id]],
    'organization:list-resolutions' => ['arguments' => fn (MatrixWorld $w) => ['sort' => 'position', 'per_page' => 5]],
    'organization:get-resolution' => ['arguments' => fn (MatrixWorld $w) => ['id' => Resolution::factory()->create()->id]],
    'manage-organization:update' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['name' => 'Matrix GmbH']]],
    'manage-organization:create-workflow' => ['arguments' => fn (MatrixWorld $w) => ['input' => WorkflowFixtures::standardInput('Matrix')]],
    'manage-organization:update-workflow' => ['arguments' => function (MatrixWorld $w) {
        $workflow = Workflow::factory()->create();

        return ['id' => $workflow->id, 'input' => [...WorkflowFixtures::inputOf($workflow), 'name' => 'Matrix']];
    }],
    'manage-organization:delete-workflow' => ['arguments' => fn (MatrixWorld $w) => ['id' => Workflow::factory()->create()->id]],
    'manage-organization:create-type' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['name' => 'Matrix', 'icon' => 'flag', 'tone' => 'moss', 'is_epic' => false, 'properties' => []]]],
    'manage-organization:update-type' => ['arguments' => fn (MatrixWorld $w) => ['id' => WorkItemType::factory()->create()->id, 'input' => ['name' => 'Matrix', 'icon' => 'flag', 'tone' => 'moss', 'is_epic' => false, 'properties' => []]]],
    'manage-organization:delete-type' => ['arguments' => fn (MatrixWorld $w) => ['id' => WorkItemType::factory()->create()->id]],
    'manage-organization:create-property' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['key' => 'matrix', 'label' => 'Matrix', 'field_type' => 'text']]],
    'manage-organization:update-property' => ['arguments' => function (MatrixWorld $w) {
        $property = Property::factory()->create();

        return ['id' => $property->id, 'input' => ['key' => $property->key, 'label' => 'Matrix', 'field_type' => $property->field_type->value]];
    }],
    'manage-organization:delete-property' => ['arguments' => fn (MatrixWorld $w) => ['id' => Property::factory()->create()->id]],
    'manage-organization:create-label' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['name' => 'Matrix', 'color' => 'moss']]],
    'manage-organization:update-label' => ['arguments' => fn (MatrixWorld $w) => ['id' => Label::factory()->create()->id, 'input' => ['name' => 'Matrix', 'color' => 'moss']]],
    'manage-organization:delete-label' => ['arguments' => fn (MatrixWorld $w) => ['id' => Label::factory()->create()->id]],
    'manage-organization:create-relation-type' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['name' => 'Matrix', 'outward_label' => 'tests']]],
    'manage-organization:update-relation-type' => ['arguments' => fn (MatrixWorld $w) => ['id' => RelationType::factory()->create()->id, 'input' => ['name' => 'Matrix', 'outward_label' => 'tests']]],
    'manage-organization:delete-relation-type' => ['arguments' => fn (MatrixWorld $w) => ['id' => RelationType::factory()->create()->id]],
    'manage-organization:create-resolution' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['label' => 'Matrix']]],
    'manage-organization:update-resolution' => ['arguments' => fn (MatrixWorld $w) => ['id' => Resolution::factory()->create()->id, 'input' => ['label' => 'Matrix']]],
    'manage-organization:delete-resolution' => ['arguments' => fn (MatrixWorld $w) => ['id' => Resolution::factory()->create()->id]],
    'people:list-users' => ['arguments' => fn (MatrixWorld $w) => ['filter' => ['type' => ['person', 'bot']], 'sort' => 'name', 'per_page' => 5]],
    'people:get-user' => ['arguments' => fn (MatrixWorld $w) => ['id' => $w->target->id]],
    'people:list-bots' => ['arguments' => fn (MatrixWorld $w) => ['per_page' => 5]],
    'people:list-invitations' => ['arguments' => fn (MatrixWorld $w) => ['per_page' => 5]],
    'people:list-tokens' => ['arguments' => fn (MatrixWorld $w) => ['per_page' => 5]],
    'people:mentionable' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier, 'q' => 'a', 'limit' => 5]],
    'manage-people:update-user' => ['arguments' => fn (MatrixWorld $w) => ['id' => $w->target->id, 'input' => ['name' => 'Matrix Name']]],
    'manage-people:set-role' => ['arguments' => fn (MatrixWorld $w) => ['id' => $w->target->id, 'input' => ['org_role' => 'member']]],
    'manage-people:deactivate' => ['arguments' => fn (MatrixWorld $w) => ['id' => $w->target->id]],
    'manage-people:reactivate' => ['arguments' => fn (MatrixWorld $w) => ['id' => $w->target->id]],
    'manage-people:create-bot' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['name' => 'Matrix Bot', 'handle' => 'matrix-bot']]],
    'manage-people:invite' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['email' => 'matrix-invite@example.com', 'org_role' => 'member']]],
    'manage-people:revoke-token' => ['arguments' => fn (MatrixWorld $w) => ['id' => $w->bot->createToken('Matrix', ['read'])->accessToken->id]],
    'projects:list' => ['arguments' => fn (MatrixWorld $w) => ['filter' => ['visibility' => ['public', 'private']], 'sort' => 'name', 'include' => ['members'], 'include_archived' => 1, 'per_page' => 5]],
    'projects:get' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'projects:members' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier, 'filter' => ['type' => 'person'], 'per_page' => 5]],
    'projects:favorites' => ['arguments' => fn (MatrixWorld $w) => ['per_page' => 5]],
    'manage-projects:create' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['name' => 'Matrix', 'identifier' => 'MTX']]],
    'manage-projects:update' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier, 'input' => ['name' => 'Matrix Web']]],
    'manage-projects:archive' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'manage-projects:restore' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'manage-projects:delete' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->ops->identifier]],
    'manage-projects:set-workflow' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier, 'input' => ['workflow_id' => Workflow::factory()->create()->id, 'mapping' => []]]],
    'manage-projects:join' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'manage-projects:add-member' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier, 'input' => ['user_id' => $w->account('outsider_public')->id, 'role' => 'viewer']]],
    'manage-projects:update-member' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier, 'user' => $w->target->id, 'input' => ['role' => 'viewer']]],
    'manage-projects:remove-member' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier, 'user' => $w->target->id]],
    'manage-projects:toggle-favorite' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['kind' => 'project', 'id' => $w->web->id]]],
    'automations:list' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier]],
    'manage-automations:update' => ['arguments' => fn (MatrixWorld $w) => ['project' => $w->web->identifier, 'key' => 'close_parent', 'input' => ['enabled' => true]]],
    'work-items:list' => ['arguments' => fn (MatrixWorld $w) => [
        'filter' => ['project' => $w->item('project_admin')->project->identifier, 'priority' => ['none', 'high']], 'sort' => '-due_date', 'lean' => 1, 'per_page' => 5,
    ]],
    'work-items:query' => ['arguments' => fn (MatrixWorld $w) => ['input' => [
        'filter' => ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'is', 'value' => $w->item('project_admin')->project_id]]], 'lean' => true, 'per_page' => 5,
    ]]],
    'work-items:groups' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['q' => $w->item('project_admin')->title, 'group_by' => 'state']]],
    'work-items:counts' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['filters' => ['all' => ['version' => 1, 'conditions' => []], 'mine' => ['version' => 1, 'conditions' => [['field' => 'assignee', 'op' => 'is', 'value' => 'me']]]]]]],
    'work-items:get' => ['arguments' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key, 'include' => ['children', 'type', 'workflow', 'relations', 'attachments']]],
    'work-items:history' => ['arguments' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key, 'per_page' => 5]],
    'work-items:subscribers' => ['arguments' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'manage-work-items:create' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['project_id' => $w->web->identifier, 'title' => 'Matrix']]],
    'manage-work-items:update' => ['arguments' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key, 'input' => ['title' => 'Matrix', 'description' => '**Matrix**']]],
    'manage-work-items:transition' => ['arguments' => function (MatrixWorld $w) {
        $item = $w->item('project_admin');

        // the standard workflow is free: any other state of it
        return ['item' => $item->key, 'input' => ['to_state_id' => $item->project->workflow->states->firstWhere('id', '!=', $item->state_id)?->id]];
    }],
    'manage-work-items:change-type' => ['arguments' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key, 'input' => ['type_id' => WorkItemType::query()->where('name', 'Bug')->value('id')]]],
    'manage-work-items:archive' => ['arguments' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin', 'closed')->key]],
    'manage-work-items:restore' => ['arguments' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin', 'archived')->key]],
    'manage-work-items:delete' => ['arguments' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'manage-work-items:bulk-update' => ['arguments' => fn (MatrixWorld $w) => ['input' => ['ids' => [$w->item('project_admin')->key], 'patch' => ['priority' => 'high']]]],
    'manage-work-items:subscribe' => ['arguments' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'manage-work-items:unsubscribe' => ['arguments' => fn (MatrixWorld $w) => ['item' => $w->item('project_admin')->key]],
    'relations:list' => ['arguments' => function (MatrixWorld $w) {
        $item = $w->item('project_admin');
        WorkItemRelation::factory()->create(['source_id' => $item->id, 'target_id' => $w->item('project_admin')->id]);

        return ['item' => $item->key];
    }],
    'manage-relations:add' => ['arguments' => fn (MatrixWorld $w) => [
        'item' => $w->item('project_admin')->key,
        'input' => ['type_id' => RelationType::query()->where('built_in', 'relates')->value('id'), 'target_id' => $w->item('project_admin')->key],
    ]],
    'manage-relations:remove' => ['arguments' => fn (MatrixWorld $w) => ['relation' => WorkItemRelation::factory()->create([
        'source_id' => $w->item('project_admin')->id, 'target_id' => $w->item('project_admin')->id,
    ])->id]],
    'views:list' => ['arguments' => fn (MatrixWorld $w) => ['filter' => ['created_by' => $w->view()->created_by], 'sort' => '-created_at', 'per_page' => 5]],
    'views:get' => ['arguments' => fn (MatrixWorld $w) => ['view' => $w->view()->id]],
    'views:items' => ['arguments' => function (MatrixWorld $w) {
        $w->item('project_admin');

        return ['view' => $w->view()->id, 'sort' => ['field' => 'key', 'direction' => 'desc'], 'show_sub_items' => true, 'lean' => true, 'per_page' => 5];
    }],
    'manage-views:create' => ['arguments' => fn (MatrixWorld $w) => ['input' => [
        'name' => 'Matrix', 'icon' => 'layers', 'filter' => ['version' => 1, 'conditions' => []],
        'display' => ['layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'rank', 'direction' => 'asc'], 'fields' => ['key', 'title'], 'show_sub_items' => true],
    ]]],
    'manage-views:update' => ['arguments' => fn (MatrixWorld $w) => ['view' => $w->view()->id, 'input' => [
        'name' => 'Matrix', 'icon' => 'list-todo', 'filter' => ['version' => 1, 'conditions' => [['field' => 'priority', 'op' => 'is', 'value' => 'high']]],
        'display' => ['layout' => 'board', 'group_by' => 'state', 'sort' => ['field' => 'due_date', 'direction' => 'desc'], 'fields' => ['key', 'title'], 'show_sub_items' => false],
    ]]],
    'manage-views:delete' => ['arguments' => fn (MatrixWorld $w) => ['view' => $w->view()->id]],
];
