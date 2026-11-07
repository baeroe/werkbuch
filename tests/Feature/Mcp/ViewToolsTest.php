<?php

use App\Access\ProjectRole;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Tools\ViewsTool;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItem;
use Tests\Support\Mcp\McpClient;
use Tests\Support\Mcp\ToolRows;
use Tests\Support\OpenApi\Document;

/*
 * The pair `views` / `manage-views` (phase 13, task 7b; K6, K8, K17): views over MCP. That every action answers what its
 * REST twin answers, McpParityTest says (tools.php); this file pins what only MCP meets: the items of a view read
 * through `POST work-items/query` with `view_id` page for page like `GET /work-items?view=`, lean unless asked, an unknown
 * view as 404, and a member who may change only the own views.
 */

/** WEB with Mara as its admin and Theo as a member, both people (Mara an org member only). */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $theo = User::factory()->create(['name' => 'Theo']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->member($theo, ProjectRole::Member)->create(['lead_id' => $mara->id]);

    return [$web, $mara, $theo];
};

it('lists the items of a view like REST ?view=', function () use ($web) {
    [$project, $mara] = $web();
    $other = Project::factory()->identifier('APP')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    foreach (['2026-11-03', null, '2026-11-01', '2026-11-05', null, '2026-11-02', '2026-11-04'] as $due) {
        WorkItem::factory()->for($project)->create(['due_date' => $due]);
    }
    WorkItem::factory()->for($other)->create(['due_date' => '2026-11-01']);
    // only WEB, by due date descending (empty last)
    $view = View::factory()->create([
        'created_by' => $mara->id,
        'filter' => ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'is', 'value' => $project->id]]],
        'display' => ['layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'due_date', 'direction' => 'desc'], 'fields' => ['key', 'title'], 'show_sub_items' => true],
    ]);
    $plain = apiToken($mara, ['read', 'mcp']);
    $rest = $this->getJson('/api/v1/work-items?view='.$view->id.'&lean=1', ['Authorization' => 'Bearer '.$plain])->assertOk()->json('data');
    forgetApiAuth();
    $mcp = McpClient::for($this, $plain);

    // three a page, following `meta.next_cursor`
    $keys = [];
    $pages = 0;
    $cursor = null;
    do {
        $page = $mcp->call('views', ['action' => 'items', 'view' => strtoupper($view->id), 'per_page' => 3, 'cursor' => $cursor]);
        expect($page['isError'])->toBeFalse((string) json_encode($page))
            ->and($page['structuredContent']['meta']['total'])->toBe(7)
            ->and($page['structuredContent']['meta']['path'])->toBe(url('api/v1/work-items/query'));
        foreach ($page['structuredContent']['data'] as $item) {
            // lean unless asked (K8)
            expect($item)->not->toHaveKey('description');
            $keys[] = $item['key'];
        }
        $cursor = $page['structuredContent']['meta']['next_cursor'];
        $pages++;
    } while ($cursor !== null);

    expect($pages)->toBe(3)
        ->and($keys)->toBe(array_column($rest, 'key'))
        ->and($keys)->toBe(['WEB-4', 'WEB-7', 'WEB-1', 'WEB-6', 'WEB-3', 'WEB-2', 'WEB-5']);

    // 25 a page and full items when asked
    $full = $mcp->call('views', ['action' => 'items', 'view' => $view->id, 'lean' => false]);
    expect($full['structuredContent']['meta']['per_page'])->toBe(25)
        ->and($full['structuredContent']['data'][0])->toHaveKey('description');
});

it('refuses an unknown view with 404', function () use ($web) {
    [, $mara] = $web();
    $mcp = McpClient::for($this, apiToken($mara, ['read', 'mcp']));

    foreach (['items', 'get'] as $action) {
        $missing = $mcp->call('views', ['action' => $action, 'view' => '01jbz7m0000000000000000000']);

        expect($missing['isError'])->toBeTrue($action)
            ->and($missing['structuredContent']['status'])->toBe(404, $action)
            ->and($missing['structuredContent']['reason'])->toBe('not_found', $action)
            ->and($missing['content'][0]['text'])->toStartWith('404 not_found: ', $action);
    }
});

it('refuses a member who changes someone else\'s view', function () use ($web) {
    [, $mara, $theo] = $web();
    $hers = View::factory()->create(['created_by' => $mara->id, 'name' => 'Maras Liste']);
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));
    $body = [
        'name' => 'Theos Liste', 'icon' => 'layers', 'filter' => ['version' => 1, 'conditions' => []],
        'display' => ['layout' => 'board', 'group_by' => 'state', 'sort' => ['field' => 'rank', 'direction' => 'asc'], 'fields' => ['key', 'title'], 'show_sub_items' => true],
    ];

    foreach (['update' => ['input' => $body], 'delete' => []] as $action => $arguments) {
        $refused = $mcp->call('manage-views', ['action' => $action, 'view' => $hers->id, ...$arguments]);

        expect($refused['isError'])->toBeTrue($action)
            ->and($refused['structuredContent']['status'])->toBe(403, $action)
            ->and($refused['structuredContent']['detail'])->toBe(__('problem.detail.view_creator_only', ['name' => 'Mara', 'view' => 'Maras Liste']), $action);
    }
    expect($hers->fresh()->name)->toBe('Maras Liste');

    // the own view: created, changed, deleted
    $created = $mcp->call('manage-views', ['action' => 'create', 'input' => $body]);
    $id = $created['structuredContent']['data']['id'];
    $changed = $mcp->call('manage-views', ['action' => 'update', 'view' => $id, 'input' => [...$body, 'name' => 'Theos Board']]);
    $read = $mcp->call('views', ['action' => 'get', 'view' => $id]);
    $deleted = $mcp->call('manage-views', ['action' => 'delete', 'view' => $id]);

    expect($created['isError'])->toBeFalse((string) json_encode($created))
        ->and($created['structuredContent']['data']['created_by'])->toBe($theo->id)
        ->and($changed['structuredContent']['data']['name'])->toBe('Theos Board')
        ->and($read['structuredContent']['data']['display']['layout'])->toBe('board')
        ->and($deleted['structuredContent'])->toBe(['done' => true])
        ->and(View::query()->whereKey($id)->exists())->toBeFalse();
});

it('describes the arguments of items like the body of work-items/query', function () {
    [, $action] = ToolRows::action('werkbuch', 'views:items');
    $body = Document::operation('POST', 'work-items/query')['requestBody']['content']['application/json']['schema']['properties'];
    // as McpSchemasTest compares schemas: reduced, keys sorted, without the default of the page (K8)
    $canonical = function (mixed $schema) use (&$canonical): mixed {
        $schema = json_decode((string) json_encode($schema), true);
        if (! is_array($schema)) {
            return $schema;
        }
        unset($schema['default']);
        $schema = array_map($canonical, $schema);
        if (! array_is_list($schema)) {
            ksort($schema);
        }

        return $schema;
    };
    $mine = array_diff_key($action->parameters, ['view' => true]);

    expect(array_keys($mine))->toBe(ViewsTool::ITEM_KEYS)
        ->and($canonical(ToolSchema::compact(['properties' => $mine])))->toBe($canonical(ToolSchema::compact(['properties' => array_intersect_key($body, $mine)])))
        ->and($action->parameters['view'])->toBe(ToolSchema::reference('view'))
        // the tool reads lean pages of 25 unless asked, and its schema says so
        ->and($action->defaultArguments())->toBe(['per_page' => McpAction::PER_PAGE, 'lean' => true]);
});
