<?php

use App\Access\ProjectRole;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use Tests\Support\Mcp\McpClient;

/*
 * The pair `relations` / `manage-relations` (phase 13, task 7b; K6, K17): relations of work items over MCP. That every
 * action answers what its REST twin answers, McpParityTest says (tools.php); this file pins what only MCP meets: a
 * hidden end for a token that does not see it, a relation to the item itself and the flow of a member who adds,
 * removes and is refused at an archived item.
 */

/** WEB with Theo as a member and the private OPS without him; one item in each. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $theo = User::factory()->create(['name' => 'Theo']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->member($theo, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id, 'visibility' => 'private']);

    return [WorkItem::factory()->for($web)->create(), WorkItem::factory()->for($ops)->create(), $mara, $theo];
};

$relates = fn (): string => RelationType::query()->where('built_in', 'relates')->value('id');

it('shows a hidden end as hidden', function () use ($world) {
    [$webItem, $opsItem, $mara, $theo] = $world();
    $relation = WorkItemRelation::factory()->create(['source_id' => $webItem->id, 'target_id' => $opsItem->id]);

    $hidden = McpClient::for($this, apiToken($theo, ['read', 'mcp']))->call('relations', ['item' => 'WEB-1']);
    $seen = McpClient::for($this, apiToken($mara, ['read', 'mcp']))->call('relations', ['item' => 'WEB-1']);

    expect($hidden['isError'])->toBeFalse((string) json_encode($hidden))
        ->and($hidden['structuredContent']['data'])->toBe([[
            'relation' => ['id' => $relation->id, 'type_id' => $relation->type_id, 'source_id' => $webItem->id, 'target_id' => ''],
            'other' => null,
            'direction' => 'outward',
            'hidden' => true,
        ]])
        // neither the key nor the ULID of the hidden item reaches the text of the result
        ->and($hidden['content'][0]['text'])->not->toContain($opsItem->id)
        ->and($hidden['content'][0]['text'])->not->toContain('OPS-1');

    // who sees OPS reads the other end
    expect($seen['structuredContent']['data'][0]['hidden'])->toBeFalse()
        ->and($seen['structuredContent']['data'][0]['other']['key'])->toBe('OPS-1')
        // and finds both in the text of the result, where Theo finds neither
        ->and($seen['content'][0]['text'])->toContain($opsItem->id)
        ->and($seen['content'][0]['text'])->toContain('OPS-1');
});

it('refuses a relation to itself', function () use ($world, $relates) {
    [$webItem, , , $theo] = $world();

    $refused = McpClient::for($this, apiToken($theo, ['write', 'mcp']))
        ->call('manage-relations', ['action' => 'add', 'item' => 'WEB-1', 'input' => ['type_id' => $relates(), 'target_id' => 'web-1']]);

    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(422)
        ->and($refused['structuredContent']['errors'])->toBe(['target_id' => [__('field.target_id.self')]])
        ->and($refused['content'][0]['text'])->toContain('target_id: '.__('field.target_id.self'))
        ->and(WorkItemRelation::query()->where('source_id', $webItem->id)->count())->toBe(0);
});

it('adds and removes a relation as a member and is refused at an archived item', function () use ($world, $relates) {
    [$webItem, , , $theo] = $world();
    $target = WorkItem::factory()->for($webItem->project)->create();
    $archived = WorkItem::factory()->for($webItem->project)->archived()->create();
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));

    $added = $mcp->call('manage-relations', ['action' => 'add', 'item' => 'WEB-1', 'input' => ['type_id' => $relates(), 'target_id' => $target->key]]);
    $relation = WorkItemRelation::query()->sole();

    expect($added['isError'])->toBeFalse((string) json_encode($added))
        // the entry as the source reads it, as REST answers its 201
        ->and($added['structuredContent']['data']['relation'])->toBe(['id' => $relation->id, 'type_id' => $relates(), 'source_id' => $webItem->id, 'target_id' => $target->id])
        ->and($added['structuredContent']['data']['direction'])->toBe('outward')
        ->and($added['structuredContent']['data']['other']['key'])->toBe($target->key);

    $removed = $mcp->call('manage-relations', ['action' => 'remove', 'relation' => strtoupper($relation->id)]);
    expect($removed['structuredContent'])->toBe(['done' => true])
        ->and(WorkItemRelation::query()->count())->toBe(0);

    // an archived item takes no relation: a 409 as a problem, nothing written
    $refused = $mcp->call('manage-relations', ['action' => 'add', 'item' => $archived->key, 'input' => ['type_id' => $relates(), 'target_id' => 'WEB-1']]);
    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(409)
        ->and($refused['structuredContent']['reason'])->toBe('archived')
        ->and($refused['content'][0]['text'])->toStartWith('409 archived: ')
        ->and(WorkItemRelation::query()->count())->toBe(0);
});

it('refuses an unknown relation with 404', function () use ($world) {
    [, , , $theo] = $world();

    $missing = McpClient::for($this, apiToken($theo, ['write', 'mcp']))->call('manage-relations', ['action' => 'remove', 'relation' => '01jbz7m0000000000000000000']);

    expect($missing['isError'])->toBeTrue()
        ->and($missing['structuredContent']['status'])->toBe(404)
        ->and($missing['structuredContent']['reason'])->toBe('not_found');
});
