<?php

use App\Access\ProjectRole;
use App\Domain\Properties\FieldType;
use App\Http\Resources\WorkItemResource;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemSubscriber;
use App\Models\WorkItemType;
use Illuminate\Support\Facades\DB;
use Tests\Support\RichTextFixtures as F;

/** The shape of `WorkItem` in resources/js/types.ts plus what the server adds (Task 5). */
const WORK_ITEM_SHAPE = [
    'id', 'project_id', 'number', 'key', 'type_id', 'title', 'description', 'description_json', 'description_version',
    'state_id', 'resolution_id', 'assignee_id', 'priority', 'label_ids', 'start_date', 'due_date', 'parent_id', 'parent',
    'rank', 'values', 'values_markdown', 'created_by', 'created_at', 'updated_at', 'started_at', 'closed_at', 'archived_at',
    'template_id', 'children_progress', 'blocked', 'blocking', 'subscribed',
];

/** WEB with Mara as its admin, and the Task type with a required `customer` and a rich text `notes`. */
$web = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $task = WorkItemType::query()->where('name', 'Task')->firstOrFail();
    $customer = Property::factory()->create(['key' => 'customer', 'label' => 'Kunde']);
    $notes = Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]);
    $task->typeProperties()->create(['property_id' => $customer->id, 'required' => true, 'position' => 0]);
    $task->typeProperties()->create(['property_id' => $notes->id, 'required' => false, 'position' => 1]);

    return [$web, $mara, $task];
};

it('creates an item and answers it with every field', function () use ($web) {
    [$project, $mara, $task] = $web();

    $response = $this->actingAs($mara)->postJson('/api/v1/work-items', [
        'project_id' => $project->id,
        'title' => '  Formular prüfen  ',
        'description' => "Erst **lesen**.\n\n- eins\n- zwei",
        'priority' => 'high',
        'due_date' => '2026-11-30',
        'values' => ['customer' => 'Feldwerk', 'notes' => '_Wichtig_'],
    ])->assertCreated();
    $item = WorkItem::query()->sole();

    expect(array_keys($response->json('data')))->toBe(WORK_ITEM_SHAPE)
        ->and($response->json('data'))->toMatchArray([
            'id' => $item->id,
            'project_id' => $project->id,
            'number' => 1,
            'key' => 'WEB-1',
            'type_id' => $task->id,
            'title' => 'Formular prüfen',
            'description' => "Erst **lesen**.\n\n- eins\n- zwei",
            'description_json' => $item->description,
            'description_version' => 1,
            'state_id' => $item->state_id,
            'resolution_id' => null,
            'assignee_id' => null,
            'priority' => 'high',
            'label_ids' => [],
            'start_date' => null,
            'due_date' => '2026-11-30',
            'parent_id' => null,
            'parent' => null,
            'rank' => 'a0',
            'values' => ['customer' => 'Feldwerk', 'notes' => F::doc(F::p(F::text('Wichtig', 'italic')))],
            'values_markdown' => ['notes' => '*Wichtig*'],
            'created_by' => $mara->id,
            'created_at' => $item->created_at?->toJSON(),
            'updated_at' => $item->updated_at?->toJSON(),
            'started_at' => null,
            'closed_at' => null,
            'archived_at' => null,
            'template_id' => null,
            'children_progress' => null,
            'blocked' => false,
            'blocking' => false,
            'subscribed' => true,
        ])
        ->and($response->json('data.description_json.content.0.content.1'))->toBe(F::text('lesen', 'bold'));
});

it('finds the project by its identifier in any case, and answers empty maps as objects', function () use ($web) {
    [, $mara] = $web();
    WorkItemType::query()->where('name', 'Task')->firstOrFail()->typeProperties()->delete();

    $response = $this->actingAs($mara)->postJson('/api/v1/work-items', ['project_id' => 'web', 'title' => 'Item'])->assertCreated()
        ->assertJsonPath('data.key', 'WEB-1');

    expect($response->getContent())->toContain('"values":{},"values_markdown":{}');
});

it('refuses a token that may only read', function () use ($web) {
    [$project, $mara] = $web();
    $input = ['project_id' => $project->id, 'title' => 'Item', 'values' => ['customer' => 'Feldwerk']];

    $this->withToken(apiToken($mara, ['read']))->postJson('/api/v1/work-items', $input)->assertForbidden();
    forgetApiAuth();
    $this->withToken(apiToken($mara, ['write']))->postJson('/api/v1/work-items', $input)->assertCreated()
        ->assertJsonPath('data.subscribed', true);

    expect(WorkItem::query()->count())->toBe(1);
});

it('changes an item over PATCH and refuses a description edited on an old version', function () use ($web) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create(['title' => 'Alt']);

    $this->withToken(apiToken($mara, ['read']))->patchJson('/api/v1/work-items/WEB-1', ['title' => 'Neu'])->assertForbidden();
    forgetApiAuth();
    $this->actingAs($mara)->patchJson('/api/v1/work-items/web-1', ['title' => '  Neu ', 'description' => '**Plan**', 'base_description_version' => 1])
        ->assertOk()
        ->assertJsonPath('data.id', $item->id)
        ->assertJsonPath('data.title', 'Neu')
        ->assertJsonPath('data.description', '**Plan**')
        ->assertJsonPath('data.description_version', 2);

    $response = $this->actingAs($mara)->patchJson("/api/v1/work-items/{$item->id}", ['description' => 'Andere Fassung', 'base_description_version' => 1])
        ->assertStatus(409)->assertHeader('Content-Type', 'application/problem+json');

    expect($response->json())->toMatchArray(['reason' => 'description_conflict', 'detail' => __('problem.detail.description_conflict', ['name' => 'Mara'])])
        ->and(array_keys($response->json('current')))->toBe(WORK_ITEM_SHAPE)
        ->and($response->json('current.description'))->toBe('**Plan**')
        ->and($response->json('current.values'))->toBe([]);
});

it('moves an item over POST …/transition and answers a refused move as problem details', function () use ($web) {
    [$project, $mara] = $web();
    $agency = Workflow::factory()->matrix([[0, 1]])->create(['name' => 'Agentur-Freigabe']);
    $project->update(['workflow_id' => $agency->id]);
    $item = WorkItem::factory()->for($project)->create();
    [$backlog, $doing, $done] = $agency->states()->pluck('id')->all();

    $this->withToken(apiToken($mara, ['read']))->postJson('/api/v1/work-items/WEB-1/transition', ['to_state_id' => $doing])->assertForbidden();
    forgetApiAuth();
    $refused = $this->actingAs($mara)->postJson('/api/v1/work-items/web-1/transition', ['to_state_id' => $done])
        ->assertStatus(409)->assertHeader('Content-Type', 'application/problem+json');

    expect($refused->json())->toMatchArray([
        'reason' => 'transition_not_allowed',
        'detail' => __('problem.detail.transition_not_allowed', ['from' => 'Backlog', 'to' => 'Done', 'workflow' => 'Agentur-Freigabe']),
    ]);

    $this->actingAs($mara)->postJson("/api/v1/work-items/{$item->id}/transition", ['to_state_id' => $doing])
        ->assertOk()
        ->assertJsonPath('data.state_id', $doing)
        ->assertJsonPath('data.resolution_id', null);
    $this->actingAs($mara)->postJson('/api/v1/work-items/WEB-1/transition', ['to_state_id' => 'Done'])
        ->assertUnprocessable()->assertJsonPath('errors.state_id.0', __('field.state_id.unknown'));

    expect($item->fresh()?->state_id)->toBe($doing)
        ->and($backlog)->toBe($agency->initial_state_id);
});

it('changes the type over PUT …/type', function () use ($web) {
    [$project, $mara, $task] = $web();
    $bug = WorkItemType::query()->where('name', 'Bug')->firstOrFail();
    $item = WorkItem::factory()->for($project)->create(['type_id' => $bug->id]);

    $this->actingAs($mara)->putJson('/api/v1/work-items/WEB-1/type', ['type_id' => $task->id, 'values' => ['customer' => '  Feldwerk ']])
        ->assertOk()
        ->assertJsonPath('data.id', $item->id)
        ->assertJsonPath('data.type_id', $task->id)
        ->assertJsonPath('data.values.customer', 'Feldwerk');
    $this->actingAs($mara)->putJson('/api/v1/work-items/WEB-1/type', ['type_id' => $bug->id, 'values' => (object) []])
        ->assertOk()->assertJsonPath('data.type_id', $bug->id)->assertJsonPath('data.values', []);
});

it('names every field error in one answer', function () use ($web) {
    [$project, $mara] = $web();

    $response = $this->actingAs($mara)->postJson('/api/v1/work-items', ['project_id' => $project->id, 'title' => '   ', 'values' => ['customer' => '']])
        ->assertUnprocessable();

    expect($response->json('errors'))->toBe([
        'title' => [__('field.title.required')],
        'values.customer' => [__('field.values.required', ['label' => 'Kunde'])],
    ]);
});

it('keeps the spaces of rich text through REST, in the description and in values', function () use ($web) {
    [$project, $mara] = $web();
    $spaced = F::doc(F::p(F::text('a '), F::text('b', 'bold'), F::text(' '), F::text('c', 'italic')));

    $this->actingAs($mara)->postJson('/api/v1/work-items', [
        'project_id' => $project->id,
        'title' => 'Item',
        'description_json' => $spaced,
        'values' => ['customer' => '  Feldwerk  ', 'notes' => $spaced],
    ])->assertCreated()
        ->assertJsonPath('data.description_json', $spaced)
        ->assertJsonPath('data.values.notes', $spaced)
        ->assertJsonPath('data.values.customer', 'Feldwerk');
});

it('loads a list for the resource with a fixed number of queries, after which the resource asks nothing', function () use ($web) {
    [$project, $mara] = $web();
    $lene = memberOf($project, ProjectRole::Member);
    $epic = WorkItem::factory()->for($project)->epic()->create(['title' => 'Relaunch']);
    WorkItem::factory()->for($project)->childOf($epic)->closed()->create();
    $child = WorkItem::factory()->for($project)->childOf($epic)->create();
    $blocker = WorkItem::factory()->for($project)->create();
    WorkItemRelation::factory()->blocks()->create(['source_id' => $blocker->id, 'target_id' => $child->id]);
    WorkItemSubscriber::query()->create(['work_item_id' => $epic->id, 'user_id' => $lene->id, 'reason' => 'manual']);
    WorkItemSubscriber::query()->create(['work_item_id' => $child->id, 'user_id' => $lene->id, 'reason' => 'manual', 'unsubscribed_at' => now()]);
    $items = WorkItem::query()->orderBy('number')->get();

    DB::enableQueryLog();
    WorkItem::loadForResource($items, $lene);
    $loading = count(DB::getQueryLog());
    DB::flushQueryLog();
    $data = $items->map(fn (WorkItem $item) => (new WorkItemResource($item))->resolve(request()))->keyBy('key');

    expect(DB::getQueryLog())->toBe([])
        ->and($loading)->toBeLessThanOrEqual(8)
        ->and($data['WEB-1']['children_progress'])->toBe(['done' => 1, 'total' => 2])
        ->and($data['WEB-1']['subscribed'])->toBeTrue()
        ->and($data['WEB-3']['parent'])->toBe(['id' => $epic->id, 'key' => 'WEB-1', 'title' => 'Relaunch'])
        ->and($data['WEB-3']['blocked'])->toBeTrue()
        ->and($data['WEB-3']['subscribed'])->toBeFalse()
        ->and($data['WEB-4']['blocking'])->toBeTrue()
        ->and($data['WEB-4']['children_progress'])->toBeNull();

    // the computed columns are no attributes to write
    $epic = $items->firstOrFail();
    $epic->update(['title' => 'Relaunch 2026']);
    expect($epic->fresh()?->title)->toBe('Relaunch 2026');
});

it('lists the items with the total', function () use ($web) {
    [$project, $mara] = $web();
    WorkItem::factory()->for($project)->count(3)->create();
    WorkItem::factory()->for($project)->archived()->create();

    $response = $this->actingAs($mara)->getJson('/api/v1/work-items?filter[project]=web&per_page=2')->assertOk()
        ->assertJsonPath('meta.total', 3)
        ->assertJsonPath('meta.per_page', 2);

    expect(array_column($response->json('data'), 'key'))->toBe(['WEB-1', 'WEB-2'])
        ->and(array_keys($response->json('data.0')))->toBe(WORK_ITEM_SHAPE);

    $this->actingAs($mara)->getJson('/api/v1/work-items?filter[q]=WEB-4')->assertOk()->assertJsonPath('meta.total', 0);
    $this->actingAs($mara)->getJson('/api/v1/work-items?filter[q]=WEB-4&include_archived=1')->assertOk()->assertJsonPath('data.0.key', 'WEB-4');
    $this->actingAs($mara)->getJson('/api/v1/work-items?filter[project]=NOPE')->assertNotFound();
    foreach (['filter[assignee]=me', 'filter[state][]=x'] as $unknown) {
        $this->actingAs($mara)->getJson("/api/v1/work-items?{$unknown}")->assertUnprocessable()
            ->assertJsonPath('errors', ['filter' => [__('field.filter.invalid')]]);
    }
});

it('shows an item and embeds children, type and workflow on request', function () use ($web) {
    [$project, $mara] = $web();
    $epic = WorkItem::factory()->for($project)->epic()->create();
    WorkItem::factory()->for($project)->childOf($epic)->closed()->create();
    WorkItem::factory()->for($project)->childOf($epic)->create();

    $plain = $this->actingAs($mara)->getJson('/api/v1/work-items/web-1')->assertOk();
    expect(array_keys($plain->json('data')))->toBe(WORK_ITEM_SHAPE)
        ->and($plain->json('data.children_progress'))->toBe(['done' => 1, 'total' => 2]);

    $this->actingAs($mara)->getJson("/api/v1/work-items/{$epic->id}?include=children,type,workflow")->assertOk()
        ->assertJsonPath('data.children.0.key', 'WEB-2')
        ->assertJsonPath('data.children.1.key', 'WEB-3')
        ->assertJsonPath('data.type.id', $epic->type_id)
        ->assertJsonPath('data.workflow.id', $project->workflow_id);
    $this->actingAs($mara)->getJson('/api/v1/work-items/WEB-1?include=type')->assertOk()
        ->assertJsonMissingPath('data.children')
        ->assertJsonPath('data.type.is_epic', true);

    $this->actingAs($mara)->getJson('/api/v1/work-items/WEB-1?include=children,comments')->assertUnprocessable()
        ->assertJsonPath('errors.include.0', __('field.include.unknown', ['name' => 'comments', 'allowed' => 'children, type, workflow']));
    $this->actingAs($mara)->getJson('/api/v1/work-items/WEB-1?include[]=type')->assertOk()->assertJsonPath('data.type.id', $epic->type_id);
    $this->actingAs($mara)->getJson('/api/v1/work-items/WEB-9')->assertNotFound();
});

it('redirects a former key with 301', function () use ($web) {
    [$project, $mara] = $web();
    $project->update(['identifier' => 'NEW']);
    $project->identifiers()->create(['identifier' => 'WEB']);
    $item = WorkItem::factory()->for($project)->create();
    $target = url('/api/v1/work-items/NEW-1');

    $this->actingAs($mara)->getJson('/api/v1/work-items/web-1?include=children')->assertStatus(301)
        ->assertHeader('Location', "{$target}?include=children")
        // no cache keeps it: a rename back to WEB must not run into a redirect stored for good
        ->assertHeader('Cache-Control', 'no-store, private');
    $this->actingAs($mara)->call('HEAD', '/api/v1/work-items/WEB-1')->assertStatus(301)->assertHeader('Location', $target);

    // the current key and the ULID answer at once
    $this->actingAs($mara)->getJson('/api/v1/work-items/NEW-1')->assertOk()->assertJsonPath('data.id', $item->id);
    $this->actingAs($mara)->getJson("/api/v1/work-items/{$item->id}")->assertOk()->assertHeaderMissing('Location');
});

it('does not redirect a former key the reader may not see', function () use ($web) {
    [, $mara] = $web();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $ops->identifiers()->create(['identifier' => 'SEC']);
    WorkItem::factory()->for($ops)->create();
    $outsider = User::factory()->create();

    $this->actingAs($outsider)->getJson('/api/v1/work-items/SEC-1')->assertNotFound()->assertHeaderMissing('Location');
    $this->actingAs($mara)->getJson('/api/v1/work-items/SEC-1?include=children')->assertNotFound()->assertHeaderMissing('Location');
    $this->actingAs(User::factory()->admin()->create())->getJson('/api/v1/work-items/SEC-1')->assertStatus(301);
});

it('archives over POST …/archive and restores over POST …/restore', function () use ($web) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->closed()->create();
    WorkItem::factory()->for($project)->create();

    $this->withToken(apiToken($mara, ['read']))->postJson('/api/v1/work-items/WEB-1/archive')->assertForbidden();
    forgetApiAuth();
    $this->actingAs($mara)->postJson('/api/v1/work-items/web-1/archive')->assertOk()
        ->assertJsonPath('data.id', $item->id)
        ->assertJsonPath('data.archived_at', $item->fresh()?->archived_at?->toJSON());
    $this->actingAs($mara)->postJson('/api/v1/work-items/WEB-2/archive')->assertStatus(409)
        ->assertHeader('Content-Type', 'application/problem+json')->assertJsonPath('reason', 'not_closed');
    $this->actingAs($mara)->postJson("/api/v1/work-items/{$item->id}/restore")->assertOk()
        ->assertJsonPath('data.archived_at', null);
    $this->actingAs($mara)->postJson('/api/v1/work-items/WEB-1/restore')->assertStatus(409)
        ->assertJsonPath('reason', 'not_archived')
        ->assertJsonPath('detail', __('problem.detail.not_archived', ['key' => 'WEB-1']));
});

it('deletes over DELETE with 204', function () use ($web) {
    [$project, $mara] = $web();
    $item = WorkItem::factory()->for($project)->create();
    $member = memberOf($project, ProjectRole::Member);

    $this->actingAs($member)->deleteJson('/api/v1/work-items/WEB-1')->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.items_delete_admins_only'));
    $this->withToken(apiToken($mara, ['read']))->deleteJson('/api/v1/work-items/WEB-1')->assertForbidden();
    forgetApiAuth();
    $this->actingAs($mara)->deleteJson('/api/v1/work-items/web-1')->assertNoContent();
    $this->actingAs($mara)->deleteJson("/api/v1/work-items/{$item->id}")->assertNotFound();

    expect(WorkItem::query()->count())->toBe(0);
});

it('lists the watchers and watches over PUT and DELETE …/subscription', function () use ($web) {
    [$project, $mara] = $web();
    $lene = memberOf($project, ProjectRole::Viewer, ['name' => 'Lene']);
    $item = WorkItem::factory()->for($project)->create();

    $this->actingAs($lene)->putJson('/api/v1/work-items/WEB-1/subscription')->assertOk()
        ->assertJsonPath('data.id', $item->id)->assertJsonPath('data.subscribed', true);
    $this->actingAs($mara)->putJson("/api/v1/work-items/{$item->id}/subscription")->assertOk()
        ->assertJsonPath('data.subscribed', true);

    $listed = $this->actingAs($lene)->getJson('/api/v1/work-items/web-1/subscribers')->assertOk();
    expect($listed->json('data.*.name'))->toBe(['Lene', 'Mara'])
        ->and(array_keys($listed->json('data.0')))->toContain('id', 'name', 'handle', 'avatar_url')
        ->and($listed->json())->toHaveKeys(['data'])->not->toHaveKey('meta');

    $this->actingAs($lene)->deleteJson('/api/v1/work-items/WEB-1/subscription')->assertOk()
        ->assertJsonPath('data.subscribed', false);
    $this->actingAs($lene)->getJson('/api/v1/work-items/WEB-1/subscribers')->assertJsonPath('data.*.name', ['Mara']);
    $this->actingAs(User::defaultBot())->putJson('/api/v1/work-items/WEB-1/subscription')->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.bots_dont_watch'));
});
