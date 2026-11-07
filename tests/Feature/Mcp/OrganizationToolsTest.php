<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Tests\Support\Mcp\McpClient;

/*
 * The pair `organization` / `manage-organization` (phase 13, task 5a; K6, K14): the organization and the six catalogs
 * over MCP. That every action answers what its REST twin answers, McpParityTest says (tools.php); this file pins what
 * only MCP meets: the refusal of a member, a list with a filter as a list, and the numbers a delete answers with.
 */

it('refuses a member who changes a catalog', function () {
    $mara = User::factory()->create();
    $label = Label::factory()->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'write', 'mcp']));

    // an organization admin only; the member gets the sentence of the catalog, as over REST
    foreach ([
        ['create-label', ['input' => ['name' => 'Matrix', 'color' => 'moss']]],
        ['update-label', ['id' => $label->id, 'input' => ['name' => 'Matrix', 'color' => 'moss']]],
        ['delete-label', ['id' => $label->id]],
    ] as [$action, $arguments]) {
        $result = $mcp->call('manage-organization', ['action' => $action, ...$arguments]);

        expect($result['isError'])->toBeTrue($action)
            ->and($result['structuredContent']['status'])->toBe(403)
            ->and($result['structuredContent']['detail'])->toBe(__('problem.detail.labels_admins_only'));
    }
    expect(Label::query()->whereKey($label->id)->exists())->toBeTrue()
        ->and(Label::query()->where('name', 'Matrix')->exists())->toBeFalse();

    // reading a catalog is open to every account
    $read = $mcp->call('organization', ['action' => 'get-label', 'id' => $label->id]);
    expect($read['isError'])->toBeFalse()
        ->and($read['structuredContent']['data']['id'])->toBe($label->id);
});

it('lists labels with a filter', function () {
    $mara = User::factory()->create();
    $ux = Label::factory()->create(['name' => 'UX Research']);
    Label::factory()->create(['name' => 'Backend']);
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));

    $result = $mcp->call('organization', ['action' => 'list-labels', 'filter' => ['name' => 'research'], 'per_page' => 5]);

    expect($result['isError'])->toBeFalse()
        ->and(array_column($result['structuredContent']['data'], 'id'))->toBe([$ux->id])
        ->and($result['structuredContent']['meta']['total'])->toBe(1)
        ->and($result['structuredContent']['meta']['path'])->toBe(url('api/v1/labels'));

    // a filter the list does not know is refused as over REST
    $unknown = $mcp->call('organization', ['action' => 'list-labels', 'filter' => ['colour' => 'sky']]);
    expect($unknown['isError'])->toBeTrue()
        ->and($unknown['structuredContent']['status'])->toBe(422);
});

it('deletes a property and says how many items lost it', function () {
    $admin = User::factory()->admin()->create();
    $project = Project::factory()->identifier('WEB')->member($admin, ProjectRole::Admin)->create(['lead_id' => $admin->id]);
    $customer = Property::factory()->create(['key' => 'customer', 'label' => 'Kunde']);
    WorkItemType::query()->where('name', 'Task')->sole()->typeProperties()->create(['property_id' => $customer->id, 'required' => false, 'position' => 1]);
    [$first, $second] = WorkItem::factory()->for($project)->count(2)->create();
    WorkItem::factory()->for($project)->create();
    UpdateWorkItem::run(actor($admin), $first, ['values' => ['customer' => 'Feldwerk']]);
    UpdateWorkItem::run(actor($admin), $second, ['values' => ['customer' => 'Hafenbau']]);
    $mcp = McpClient::for($this, apiToken($admin, ['read', 'write', 'mcp']));

    $result = $mcp->call('manage-organization', ['action' => 'delete-property', 'id' => $customer->id]);

    expect($result['isError'])->toBeFalse()
        ->and($result['structuredContent'])->toBe(['affected_items' => 2])
        ->and(Property::query()->whereKey($customer->id)->exists())->toBeFalse();

    // an entry that is gone is a 404, not a count
    $gone = $mcp->call('manage-organization', ['action' => 'delete-property', 'id' => $customer->id]);
    expect($gone['isError'])->toBeTrue()
        ->and($gone['structuredContent']['status'])->toBe(404);
});

it('counts the items per state of a project', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->create();
    WorkItem::factory()->for($web)->count(3)->create();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));

    $result = $mcp->call('organization', ['action' => 'state-usage', 'project' => 'web']);
    $none = $mcp->call('organization', ['action' => 'state-usage']);

    expect($result['isError'])->toBeFalse()
        ->and(array_sum(array_column($result['structuredContent']['data'], 'items')))->toBe(3)
        // neither project nor workflow: 422 as over REST
        ->and($none['isError'])->toBeTrue()
        ->and($none['structuredContent']['status'])->toBe(422);
});
