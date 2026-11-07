<?php

use App\Access\ProjectRole;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use Tests\Support\Mcp\McpClient;

/*
 * The pair `templates` / `manage-templates` (phase 13, task 9; K6, K8, K17): templates over MCP. That every action
 * answers what its REST twin answers, McpParityTest says (tools.php); this file pins what only MCP meets: the lean
 * list by default, a run that fails and says why, and a viewer who is refused.
 */

/** WEB with Mara (lead) and Theo as members; a template with a long description. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $theo = User::factory()->create(['name' => 'Theo']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->member($theo, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    $template = Template::factory()->create(['project_id' => $web->id, 'name' => 'Wartung', 'created_by' => $mara->id]);

    return [$web, $template, $mara, $theo];
};

it('lists templates lean unless asked', function () use ($world) {
    [, $template, , $theo] = $world();
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'mcp']));

    $lean = $mcp->call('templates', ['action' => 'list']);
    $full = $mcp->call('templates', ['action' => 'list', 'lean' => 0]);
    $payload = $lean['structuredContent']['data'][0]['payload'];

    expect($lean['isError'])->toBeFalse((string) json_encode($lean))
        ->and(array_column($lean['structuredContent']['data'], 'id'))->toBe([$template->id])
        ->and($lean['structuredContent']['meta']['per_page'])->toBe(25)
        ->and($lean['structuredContent']['meta']['path'])->toBe(url('api/v1/templates'))
        ->and(array_key_exists('description', $payload))->toBeFalse((string) json_encode($payload))
        ->and(array_key_exists('values_markdown', $payload))->toBeFalse((string) json_encode($payload))
        ->and(array_key_exists('values_markdown', $full['structuredContent']['data'][0]['payload']))->toBeFalse('values_markdown goes in markdown form')
        ->and(array_key_exists('description', $full['structuredContent']['data'][0]['payload']))->toBeTrue((string) json_encode($full['structuredContent']['data'][0]['payload']));
});

it('creates, replaces and deletes a template', function () use ($world) {
    [$web, , , $theo] = $world();
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));
    $body = ['name' => 'Bericht', 'payload' => ['title' => 'Bericht {month_name}'], 'schedule' => null];

    $created = $mcp->call('manage-templates', ['action' => 'create', 'project' => 'web', 'input' => $body]);
    $id = $created['structuredContent']['data']['id'];
    expect($created['isError'])->toBeFalse((string) json_encode($created))
        ->and($created['structuredContent']['data']['project_id'])->toBe($web->id);

    $replaced = $mcp->call('manage-templates', ['action' => 'update', 'template' => $id, 'input' => [...$body, 'name' => 'Monatsbericht']]);
    expect($replaced['structuredContent']['data']['name'])->toBe('Monatsbericht');

    $deleted = $mcp->call('manage-templates', ['action' => 'delete', 'template' => $id]);
    expect($deleted['structuredContent'])->toBe(['done' => true])
        ->and(Template::query()->whereKey($id)->exists())->toBeFalse();
});

it('runs a template now and reads its draft, runs and a preview', function () use ($world) {
    [, $template, , $theo] = $world();
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));

    $ran = $mcp->call('manage-templates', ['action' => 'run', 'template' => $template->id]);
    $run = TemplateRun::query()->sole();
    expect($ran['isError'])->toBeFalse((string) json_encode($ran))
        ->and($ran['structuredContent']['data']['run']['id'])->toBe($run->id)
        ->and($ran['structuredContent']['data']['run']['status'])->toBe('created')
        ->and($ran['structuredContent']['data']['item']['id'])->toBe($run->work_item_id)
        ->and($run->triggered_by)->toBe($theo->id);

    $runs = $mcp->call('templates', ['action' => 'runs', 'template' => $template->id]);
    $draft = $mcp->call('templates', ['action' => 'draft', 'template' => $template->id]);
    $preview = $mcp->call('templates', ['action' => 'preview', 'input' => ['schedule' => ['frequency' => 'daily', 'interval' => 1, 'time' => '09:00', 'starts_on' => '2026-11-01', 'ends' => ['type' => 'never']]]]);

    expect(array_column($runs['structuredContent']['data'], 'id'))->toBe([$run->id])
        ->and($draft['structuredContent']['data']['template_id'])->toBe($template->id)
        ->and($preview['structuredContent']['data']['runs'])->toHaveCount(5);
});

it('answers a failed run with its sentence', function () use ($world) {
    [$web, $template, , $theo] = $world();
    // a template whose assignee left the project: the run fails, the answer says why (A350)
    $leaver = User::factory()->create();
    $template->forceFill(['payload' => [...$template->payload, 'assignee_id' => $leaver->id]])->save();
    $mcp = McpClient::for($this, apiToken($theo, ['read', 'write', 'mcp']));

    $ran = $mcp->call('manage-templates', ['action' => 'run', 'template' => $template->id]);

    expect($ran['isError'])->toBeFalse((string) json_encode($ran))
        ->and($ran['structuredContent']['data']['run']['status'])->toBe('failed')
        ->and($ran['structuredContent']['data']['run']['error'])->toBe(__('field.assignee_id.invalid'))
        ->and($ran['structuredContent']['data']['item'])->toBeNull()
        ->and(WorkItem::query()->count())->toBe(0);
});

it('refuses a viewer to run and an unknown template with 404', function () use ($world) {
    [$web, $template] = $world();
    $viewer = memberOf($web, ProjectRole::Viewer);
    $mcp = McpClient::for($this, apiToken($viewer, ['read', 'write', 'mcp']));

    $refused = $mcp->call('manage-templates', ['action' => 'run', 'template' => $template->id]);
    $unknown = $mcp->call('templates', ['action' => 'get', 'template' => 'not-a-ulid']);

    expect($refused['isError'])->toBeTrue()
        ->and($refused['structuredContent']['status'])->toBe(403)
        ->and($refused['structuredContent']['detail'])->toBe(__('problem.detail.templates_members_only'))
        ->and(TemplateRun::query()->count())->toBe(0)
        ->and([$unknown['structuredContent']['status'], $unknown['structuredContent']['reason']])->toBe([404, 'not_found']);
});
