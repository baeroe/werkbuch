<?php

use App\Access\ProjectRole;
use App\Domain\Properties\FieldType;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Property;
use App\Models\Template;
use App\Models\User;
use App\Models\WorkItemType;

/*
 * Templates over REST (Task 4): `GET /api/v1/templates` (every visible project, `?project=` narrows), `GET`/`POST
 * /api/v1/projects/{project}/templates`, `GET`/`PUT`/`DELETE /api/v1/templates/{template}` (`{template}` by its ULID
 * only). WEB (public) with Mara as its admin and Lene as a viewer.
 */

$world = function (): array {
    Organization::current()->update(['timezone' => 'Europe/Berlin']);
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create();
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);

    return [$web, $mara, $lene];
};

$input = fn (array $payload = []): array => [
    'name' => 'Monatsbericht',
    'payload' => ['title' => 'Monatsbericht {month_name}', 'description' => 'Kennzahlen mit @mara', 'priority' => 'medium', ...$payload],
    'schedule' => [
        'frequency' => 'monthly', 'interval' => 1, 'nth_weekday' => ['n' => 1, 'weekday' => 1], 'time' => '09:00',
        'starts_on' => '2026-09-01', 'ends' => ['type' => 'never'], 'paused' => false,
    ],
];

it('creates a template and answers it in its shape', function () use ($world, $input) {
    [$web, $mara] = $world();
    $notes = Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]);
    $task = WorkItemType::query()->where('name', 'Task')->firstOrFail();
    $task->typeProperties()->create(['property_id' => $notes->id, 'required' => false, 'position' => 0]);
    $this->travelTo('2026-10-28 09:00:00');

    $response = $this->actingAs($mara)->postJson('/api/v1/projects/web/templates', $input(['values' => ['notes' => 'Für @mara']]))->assertCreated();
    $id = $response->json('data.id');

    expect(array_keys($response->json('data')))->toBe([
        'id', 'project_id', 'name', 'payload', 'schedule', 'run_count', 'last_run_at', 'next_run_at', 'created_by', 'created_at', 'updated_at',
    ])
        ->and(array_keys($response->json('data.payload')))->toBe([
            'type_id', 'title', 'description', 'description_json', 'priority', 'assignee_id', 'label_ids', 'values', 'values_markdown',
            'parent_id', 'start_offset_days', 'due_offset_days',
        ])
        ->and($response->json('data.project_id'))->toBe($web->id)
        ->and($response->json('data.payload.description'))->toBe('Kennzahlen mit @mara')
        ->and($response->json('data.payload.description_json.type'))->toBe('doc')
        ->and($response->json('data.payload.values.notes.type'))->toBe('doc')
        ->and($response->json('data.payload.values_markdown'))->toBe(['notes' => 'Für @mara'])
        ->and($response->json('data.schedule.nth_weekday'))->toBe(['n' => 1, 'weekday' => 1])
        ->and($response->json('data.run_count'))->toBe(0)
        ->and($response->json('data.last_run_at'))->toBeNull()
        ->and($response->json('data.next_run_at'))->toBe('2026-11-02T08:00:00.000000Z')
        ->and($response->json('data.created_by'))->toBe($mara->id)
        ->and(Template::query()->whereKey($id)->exists())->toBeTrue();
});

it('answers an empty values map as an object', function () use ($world, $input) {
    [, $mara] = $world();

    $response = $this->actingAs($mara)->postJson('/api/v1/projects/web/templates', $input())->assertCreated();

    expect($response->getContent())->toContain('"values":{}')
        ->and($response->getContent())->toContain('"values_markdown":{}');
});

it('lists the templates of all projects or one, and lean ones without their texts', function () use ($world) {
    [$web, , $lene] = $world();
    Template::factory()->create(['project_id' => $web->id, 'name' => 'Wartung']);
    $ops = Project::factory()->identifier('OPS')->private()->create();
    Template::factory()->create(['project_id' => $ops->id, 'name' => 'Geheim']);

    $this->actingAs($lene)->getJson('/api/v1/templates')->assertOk()
        ->assertJsonPath('meta.total', 1)
        ->assertJsonPath('data.0.name', 'Wartung');
    $this->actingAs($lene)->getJson("/api/v1/templates?filter[project_id]={$web->id}")->assertOk()->assertJsonPath('meta.total', 1);
    // a project the reader does not see answers like an unknown one: nothing (K11)
    $this->actingAs($lene)->getJson("/api/v1/templates?filter[project_id]={$ops->id}")->assertOk()->assertJsonPath('meta.total', 0);
    $this->actingAs($lene)->getJson('/api/v1/projects/web/templates')->assertOk()->assertJsonPath('data.0.name', 'Wartung');
    $this->actingAs($lene)->getJson('/api/v1/projects/OPS/templates')->assertNotFound()->assertJsonMissingPath('detail');

    $lean = $this->actingAs($lene)->getJson('/api/v1/templates?lean=1')->assertOk();
    expect(array_keys($lean->json('data.0.payload')))->not->toContain('description', 'description_json', 'values_markdown')
        ->and(array_keys($lean->json('data.0.payload')))->toContain('values');
});

it('knows a template by nothing but its ULID, in either case', function () use ($world) {
    [$web, , $lene] = $world();
    $template = Template::factory()->create(['project_id' => $web->id]);

    $this->actingAs($lene)->getJson("/api/v1/templates/{$template->id}")->assertOk()->assertJsonPath('data.id', $template->id);
    $this->actingAs($lene)->getJson('/api/v1/templates/'.strtoupper($template->id))->assertOk()->assertJsonPath('data.id', $template->id);
    $this->actingAs($lene)->getJson('/api/v1/templates/wartung')->assertNotFound();
    $this->actingAs($lene)->getJson('/api/v1/templates/01jc0000000000000000000000')->assertNotFound();
});

it('replaces a template with PUT and deletes it with 204', function () use ($world, $input) {
    [$web, $mara, $lene] = $world();
    $template = Template::factory()->create(['project_id' => $web->id]);

    $this->actingAs($mara)->putJson("/api/v1/templates/{$template->id}", $input())->assertOk()
        ->assertJsonPath('data.name', 'Monatsbericht')
        ->assertJsonPath('data.payload.priority', 'medium');
    $this->actingAs($lene)->putJson("/api/v1/templates/{$template->id}", $input())->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.templates_members_only'));
    $this->actingAs($mara)->putJson("/api/v1/templates/{$template->id}", ['name' => '', 'payload' => ['title' => ''], 'schedule' => null])->assertUnprocessable()
        ->assertJsonPath('errors.name.0', __('field.name.required'))
        ->assertJsonPath('errors', fn (array $errors) => array_keys($errors) === ['name', 'payload.title']);
    $this->actingAs($mara)->deleteJson("/api/v1/templates/{$template->id}")->assertNoContent();

    expect(Template::query()->count())->toBe(0);
});

it('lets a token that only reads read the templates, not write one', function () use ($world, $input) {
    [$web, $mara] = $world();
    $template = Template::factory()->create(['project_id' => $web->id]);
    $token = apiToken($mara, ['read']);

    $this->withToken($token)->getJson('/api/v1/templates')->assertOk()->assertJsonPath('meta.total', 1);
    $this->withToken($token)->getJson("/api/v1/templates/{$template->id}")->assertOk();
    $this->withToken($token)->postJson('/api/v1/projects/web/templates', $input())->assertForbidden();
    $this->withToken($token)->deleteJson("/api/v1/templates/{$template->id}")->assertForbidden();

    expect(Template::query()->count())->toBe(1);
});
