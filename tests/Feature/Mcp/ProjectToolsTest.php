<?php

use App\Access\ProjectRole;
use App\Models\Automation;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use Tests\Support\Mcp\McpClient;

/*
 * The pairs `projects` / `manage-projects` and `automations` / `manage-automations` (phase 13, task 6; K5, K6): projects,
 * members, favorites and the four automations over MCP. That every action answers what its REST twin answers,
 * McpParityTest says (tools.php); this file pins what only MCP meets: the problem with its `states`, an exception of
 * Laravel as 404, `delete` as `{done: true}`, a list filter and the refusal of a member.
 */

it('answers the missing state mapping as a problem with states', function () {
    $admin = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($admin, ProjectRole::Admin)->create();
    $item = WorkItem::factory()->for($web)->create();
    $old = $item->state_id;
    $workflow = Workflow::factory()->create();
    $backlog = $workflow->states->firstWhere('name', 'Backlog')->id;
    $mcp = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));

    $refused = $mcp->call('manage-projects', ['action' => 'set-workflow', 'project' => 'WEB', 'input' => ['workflow_id' => $workflow->id, 'mapping' => []]]);

    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(422)
        ->and(array_keys($refused['structuredContent']['errors']))->toBe(["mapping.{$old}"])
        ->and($refused['structuredContent']['states'])->toBe([['state_id' => $old, 'name' => 'Backlog', 'items' => 1]])
        ->and($web->refresh()->workflow_id)->not->toBe($workflow->id);

    $switched = $mcp->call('manage-projects', ['action' => 'set-workflow', 'project' => 'WEB', 'input' => ['workflow_id' => $workflow->id, 'mapping' => [$old => $backlog]]]);

    expect($switched['isError'])->toBeFalse((string) json_encode($switched))
        ->and($switched['structuredContent']['data']['workflow_id'])->toBe($workflow->id)
        ->and($item->refresh()->state_id)->toBe($backlog);
});

it('answers an exception of Laravel as 404 like REST', function () {
    $admin = User::factory()->admin()->create();
    $mcp = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));

    $web = Project::factory()->identifier('WEB')->create();

    // no default workflow: `Workflow::default()` throws a ModelNotFoundException
    Workflow::query()->update(['is_default' => false]);
    $created = $mcp->call('manage-projects', ['action' => 'create', 'input' => ['name' => 'Neu', 'identifier' => 'NEU']]);
    expect($created['isError'])->toBeTrue()
        ->and($created['structuredContent']['status'])->toBe(404)
        ->and(Project::query()->where('identifier', 'NEU')->exists())->toBeFalse();

    // an account that is none: the reference of the path is 404 like the binding of REST
    $unknown = $mcp->call('manage-projects', ['action' => 'update-member', 'project' => $web->identifier, 'user' => '01JZZZZZZZZZZZZZZZZZZZZZZZ', 'input' => ['role' => 'viewer']]);
    expect($unknown['isError'])->toBeTrue()
        ->and($unknown['structuredContent']['status'])->toBe(404);
});

it('archives, restores and deletes a project, deleting as done', function () {
    $admin = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($admin, ProjectRole::Admin)->create();
    $mcp = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));

    $archived = $mcp->call('manage-projects', ['action' => 'archive', 'project' => 'WEB']);
    expect($archived['isError'])->toBeFalse((string) json_encode($archived))
        ->and($archived['structuredContent']['data']['archived_at'])->not->toBeNull();

    $restored = $mcp->call('manage-projects', ['action' => 'restore', 'project' => 'WEB']);
    expect($restored['structuredContent']['data']['archived_at'])->toBeNull();

    $deleted = $mcp->call('manage-projects', ['action' => 'delete', 'project' => 'WEB']);
    expect($deleted['isError'])->toBeFalse((string) json_encode($deleted))
        ->and($deleted['structuredContent'])->toBe(['done' => true])
        // the purge runs at once on the sync queue of the tests
        ->and(Project::query()->whereKey($web->id)->exists())->toBeFalse();

    $gone = $mcp->call('projects', ['action' => 'get', 'project' => 'WEB']);
    expect($gone['isError'])->toBeTrue()
        ->and($gone['structuredContent']['status'])->toBe(404);
});

it('lists the projects of the account with a filter and the members', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->create();
    Project::factory()->identifier('PUB')->public()->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));

    $mine = $mcp->call('projects', ['action' => 'list', 'filter' => ['member' => true], 'include' => ['members'], 'per_page' => 100]);

    expect($mine['isError'])->toBeFalse((string) json_encode($mine))
        ->and(array_column($mine['structuredContent']['data'], 'identifier'))->toBe(['WEB'])
        ->and(array_column($mine['structuredContent']['data'][0]['members'], 'user_id'))->toContain($mara->id);

    $members = $mcp->call('projects', ['action' => 'members', 'project' => $web->identifier]);
    expect(array_column($members['structuredContent']['data'], 'user_id'))->toBe([$mara->id]);
});

it('joins, toggles a favorite and manages the members', function () {
    $admin = User::factory()->create();
    $kira = User::factory()->create();
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->public()->member($admin, ProjectRole::Admin)->create();
    $adminMcp = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));
    $maraMcp = McpClient::for($this, apiToken($mara, ['read', 'write', 'mcp']));

    $joined = $maraMcp->call('manage-projects', ['action' => 'join', 'project' => 'WEB']);
    expect($joined['isError'])->toBeFalse((string) json_encode($joined))
        ->and($joined['structuredContent']['data']['role'])->toBe('member');

    $twice = $maraMcp->call('manage-projects', ['action' => 'join', 'project' => 'WEB']);
    expect($twice['structuredContent']['status'])->toBe(409)
        ->and($twice['structuredContent']['reason'])->toBe('already_member');

    $on = $maraMcp->call('manage-projects', ['action' => 'toggle-favorite', 'input' => ['kind' => 'project', 'id' => $web->id]]);
    expect($on['structuredContent'])->toMatchArray(['kind' => 'project', 'favorite' => true]);
    $favorites = $maraMcp->call('projects', ['action' => 'favorites']);
    expect($favorites['structuredContent']['data'])->toHaveCount(1);

    $added = $adminMcp->call('manage-projects', ['action' => 'add-member', 'project' => 'WEB', 'input' => ['user_id' => $kira->id, 'role' => 'viewer']]);
    expect($added['isError'])->toBeFalse((string) json_encode($added));
    $changed = $adminMcp->call('manage-projects', ['action' => 'update-member', 'project' => 'WEB', 'user' => $kira->id, 'input' => ['role' => 'member']]);
    expect($changed['structuredContent']['data']['role'])->toBe('member');
    $removed = $adminMcp->call('manage-projects', ['action' => 'remove-member', 'project' => 'WEB', 'user' => $kira->id]);
    expect($removed['structuredContent'])->toBe(['done' => true]);
});

it('refuses a member who changes a project or an automation', function () {
    $mara = User::factory()->create();
    $kira = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'write', 'mcp']));

    foreach ([
        ['manage-projects', ['action' => 'archive', 'project' => 'WEB']],
        ['manage-projects', ['action' => 'delete', 'project' => 'WEB']],
        ['manage-projects', ['action' => 'add-member', 'project' => 'WEB', 'input' => ['user_id' => $kira->id, 'role' => 'member']]],
        ['manage-automations', ['action' => 'update', 'project' => 'WEB', 'key' => 'close_parent', 'input' => ['enabled' => true]]],
    ] as [$tool, $arguments]) {
        $result = $mcp->call($tool, $arguments);

        expect($result['isError'])->toBeTrue($arguments['action'])
            ->and($result['structuredContent']['status'])->toBe(403, $arguments['action']);
    }
    expect($web->refresh()->archived_at)->toBeNull()
        ->and($web->deleting_at)->toBeNull()
        ->and(Automation::query()->count())->toBe(0);
});

it('lists the five automations and switches one by its key', function () {
    $admin = User::factory()->create();
    Project::factory()->identifier('WEB')->member($admin, ProjectRole::Admin)->create();
    $mcp = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));

    $list = $mcp->call('automations', ['action' => 'list', 'project' => 'WEB']);
    expect(array_column($list['structuredContent']['data'], 'key'))->toBe(['auto_archive', 'auto_close', 'close_parent', 'assign_on_start', 'link_references']);

    $on = $mcp->call('manage-automations', ['action' => 'update', 'project' => 'WEB', 'key' => 'auto_archive', 'input' => ['enabled' => true, 'settings' => ['days' => 14]]]);
    expect($on['isError'])->toBeFalse((string) json_encode($on))
        ->and($on['structuredContent']['data']['enabled'])->toBeTrue()
        ->and($on['structuredContent']['data']['settings']['days'])->toBe(14);

    // a key that is none: 404 like REST
    $unknown = $mcp->call('manage-automations', ['action' => 'update', 'project' => 'WEB', 'key' => 'nope', 'input' => ['enabled' => true]]);
    expect($unknown['isError'])->toBeTrue()
        ->and($unknown['structuredContent']['status'])->toBe(404);
});
