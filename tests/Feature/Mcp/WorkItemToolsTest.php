<?php

use App\Access\ProjectRole;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use Tests\Support\Mcp\McpClient;

/*
 * The pair `work-items` / `manage-work-items` (phase 13, task 7a; K6, K7, K8, K12): work items over MCP. That every
 * action answers what its REST twin answers, McpParityTest says (tools.php); this file pins what only MCP meets: a refused
 * move of a member as a problem, the conflict of a description with the current item in Markdown, an item by its former
 * key without a redirect, `via` `mcp` in the history, the counts of a filter object against a list, the lean default of
 * a list and an empty `values` object.
 */

/** WEB with Mara as its admin and Theo as a member, both people. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $theo = User::factory()->create(['name' => 'Theo']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->member($theo, ProjectRole::Member)->create(['lead_id' => $mara->id]);

    return [$web, $mara, $theo];
};

it('refuses a disallowed transition and takes an allowed one', function () use ($web) {
    [$project, , $theo] = $web();
    $agency = Workflow::factory()->matrix([[0, 1]])->create(['name' => 'Agentur-Freigabe']);
    $project->update(['workflow_id' => $agency->id]);
    $item = WorkItem::factory()->for($project)->create();
    [, $doing, $done] = $agency->states()->pluck('id')->all();
    // a member, not an org admin
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));

    $refused = $mcp->call('manage-work-items', ['action' => 'transition', 'item' => 'web-1', 'input' => ['to_state_id' => $done]]);

    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(409)
        ->and($refused['structuredContent']['reason'])->toBe('transition_not_allowed')
        ->and($refused['structuredContent']['detail'])->toBe(__('problem.detail.transition_not_allowed', ['from' => 'Backlog', 'to' => 'Done', 'workflow' => 'Agentur-Freigabe']))
        ->and($refused['content'][0]['text'])->toStartWith('409 transition_not_allowed: ')
        ->and($item->refresh()->state_id)->toBe($agency->initial_state_id);

    $moved = $mcp->call('manage-work-items', ['action' => 'transition', 'item' => 'WEB-1', 'input' => ['to_state_id' => $doing]]);

    expect($moved['isError'])->toBeFalse((string) json_encode($moved))
        ->and($moved['structuredContent']['data']['state_id'])->toBe($doing)
        ->and($item->refresh()->state_id)->toBe($doing);
});

it('answers a description conflict with the current item in markdown', function () use ($web) {
    [$project, $mara, $theo] = $web();
    WorkItem::factory()->for($project)->create();
    $this->withToken(apiToken($mara, ['write']))->patchJson('/api/v1/work-items/WEB-1', ['description' => '**Plan**', 'base_description_version' => 1])->assertOk();
    forgetApiAuth();
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));

    $conflict = $mcp->call('manage-work-items', ['action' => 'update', 'item' => 'WEB-1', 'input' => ['description' => 'Andere Fassung', 'base_description_version' => 1]]);
    $current = $conflict['structuredContent']['current'];

    expect($conflict['isError'])->toBeTrue()
        ->and($conflict['structuredContent']['status'])->toBe(409)
        ->and($conflict['structuredContent']['reason'])->toBe('description_conflict')
        ->and($current['description'])->toBe('**Plan**')
        ->and($current['description_version'])->toBe(2)
        ->and(array_key_exists('description_json', $current))->toBeFalse((string) json_encode($current))
        ->and(array_key_exists('values_markdown', $current))->toBeFalse((string) json_encode($current));
});

it('reads an item by its former key', function () use ($web) {
    [$project, $mara] = $web();
    $project->update(['identifier' => 'NEW']);
    $project->identifiers()->create(['identifier' => 'WEB']);
    $item = WorkItem::factory()->for($project)->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));

    $read = $mcp->call('work-items', ['action' => 'get', 'item' => 'web-1', 'include' => ['children', 'type']]);

    expect($read['isError'])->toBeFalse((string) json_encode($read))
        ->and($read['structuredContent']['data']['id'])->toBe($item->id)
        ->and($read['structuredContent']['data']['key'])->toBe('NEW-1')
        ->and($read['structuredContent']['data']['children'])->toBe([])
        ->and($read['structuredContent']['data']['type']['id'])->toBe($item->type_id);

    // `include` also as comma text, like the query of REST
    $text = $mcp->call('work-items', ['action' => 'get', 'item' => 'NEW-1', 'include' => 'workflow,attachments']);
    expect($text['structuredContent']['data']['workflow']['id'])->toBe($project->workflow_id)
        ->and($text['structuredContent']['data']['attachments'])->toBe([]);
});

it('records via mcp in the history', function () use ($web) {
    [$project, , $theo] = $web();
    WorkItem::factory()->for($project)->create(['title' => 'Alt']);
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));

    $changed = $mcp->call('manage-work-items', ['action' => 'update', 'item' => 'WEB-1', 'input' => ['title' => 'Neu']]);
    $history = $mcp->call('work-items', ['action' => 'history', 'item' => 'WEB-1']);

    expect($changed['isError'])->toBeFalse((string) json_encode($changed))
        ->and($history['isError'])->toBeFalse((string) json_encode($history))
        ->and($history['structuredContent']['meta']['per_page'])->toBe(25)
        ->and(collect($history['structuredContent']['data'])->last())->toMatchArray([
            'type' => 'work_item.updated', 'actor_id' => $theo->id, 'via' => 'mcp', 'changes' => ['title' => ['old' => 'Alt', 'new' => 'Neu']],
        ]);
});

it('counts a filter named like a list index', function () use ($web) {
    [$project, $mara] = $web();
    WorkItem::factory()->for($project)->count(2)->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));
    $all = ['version' => 1, 'conditions' => []];

    // PHP decodes `{"0": …}` into a list; the raw body tells the object
    $counted = $mcp->call('work-items', ['action' => 'counts', 'input' => ['filters' => (object) ['0' => $all, '1' => $all]]]);

    expect($counted['isError'])->toBeFalse((string) json_encode($counted))
        ->and($counted['structuredContent'])->toBe(['data' => ['0' => 2, '1' => 2]]);
    // and stays an object in the JSON of the result
    expect((string) json_encode(json_decode($counted['content'][0]['text'])))->toBe('{"data":{"0":2,"1":2}}');
});

it('refuses a list of filters like REST', function () use ($web) {
    [, $mara] = $web();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));

    $refused = $mcp->call('work-items', ['action' => 'counts', 'input' => ['filters' => [['version' => 1, 'conditions' => []]]]]);

    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(422)
        ->and($refused['structuredContent']['errors'])->toBe(['filters' => [__('field.filters.invalid', ['max' => 50])]]);

    // an `input` that is no object leaves the raw body unread: the missing filters, no crash
    $text = $mcp->call('work-items', ['action' => 'counts', 'input' => 'filters']);
    expect($text['structuredContent']['status'])->toBe(422)
        ->and(array_keys($text['structuredContent']['errors']))->toBe(['filters']);
});

it('lists items lean unless asked', function () use ($web) {
    [$project, $mara] = $web();
    WorkItem::factory()->for($project)->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));

    $lean = $mcp->call('work-items', ['action' => 'list', 'filter' => ['project' => 'WEB']]);
    $full = $mcp->call('work-items', ['action' => 'list', 'filter' => ['project' => 'WEB'], 'lean' => false]);
    $query = $mcp->call('work-items', ['action' => 'query', 'input' => ['shorthand' => ['project' => 'WEB']]]);
    $queryFull = $mcp->call('work-items', ['action' => 'query', 'input' => ['shorthand' => ['project' => 'WEB'], 'lean' => false]]);

    expect($lean['isError'])->toBeFalse((string) json_encode($lean))
        ->and($lean['structuredContent']['meta']['per_page'])->toBe(25)
        ->and($lean['structuredContent']['meta']['path'])->toBe(url('api/v1/work-items'))
        ->and($lean['structuredContent']['data'][0])->not->toHaveKey('description')
        ->and($full['structuredContent']['data'][0])->toHaveKey('description')
        // the query reads its page in the body: lean and 25 a page there too, unless asked
        ->and($query['structuredContent']['meta']['per_page'])->toBe(25)
        ->and($query['structuredContent']['data'][0])->not->toHaveKey('description')
        ->and($queryFull['structuredContent']['data'][0])->toHaveKey('description');
});

it('takes lists in the short form of a list as lists', function () use ($web) {
    [$project, $mara, $theo] = $web();
    WorkItem::factory()->for($project)->create(['assignee_id' => $mara->id, 'priority' => 'high']);
    WorkItem::factory()->for($project)->create(['assignee_id' => $theo->id, 'priority' => 'low']);
    WorkItem::factory()->for($project)->create(['priority' => 'urgent']);
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));

    // over REST `filter[assignee]=me,<ulid>&filter[priority]=high,low`
    $listed = $mcp->call('work-items', ['action' => 'list', 'filter' => ['assignee' => ['me', $theo->id], 'priority' => ['high', 'low']], 'sort' => 'key']);

    expect($listed['isError'])->toBeFalse((string) json_encode($listed))
        ->and(array_column($listed['structuredContent']['data'], 'key'))->toBe(['WEB-1', 'WEB-2']);
});

it('keeps the values of an item an object', function () use ($web) {
    [$project, $mara] = $web();
    WorkItem::factory()->for($project)->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));

    $read = $mcp->call('work-items', ['action' => 'get', 'item' => 'WEB-1']);

    expect($read['isError'])->toBeFalse((string) json_encode($read))
        ->and($read['content'][0]['text'])->toContain('"values":{}');
});

it('deletes an item as done and watches it on and off', function () use ($web) {
    [$project, $mara, $theo] = $web();
    $item = WorkItem::factory()->for($project)->create();
    WorkItem::factory()->for($project)->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'write', 'mcp']));

    $on = $mcp->call('manage-work-items', ['action' => 'subscribe', 'item' => 'WEB-2']);
    $off = $mcp->call('manage-work-items', ['action' => 'unsubscribe', 'item' => 'WEB-2']);
    expect($on['structuredContent']['data']['subscribed'])->toBeTrue()
        ->and($off['structuredContent']['data']['subscribed'])->toBeFalse();

    // a member may not delete; the item stays
    $refused = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']))->call('manage-work-items', ['action' => 'delete', 'item' => 'WEB-1']);
    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(403)
        ->and($item->fresh())->not->toBeNull();

    $deleted = $mcp->call('manage-work-items', ['action' => 'delete', 'item' => 'WEB-1']);
    expect($deleted['structuredContent'])->toBe(['done' => true])
        ->and($item->fresh())->toBeNull();
});
