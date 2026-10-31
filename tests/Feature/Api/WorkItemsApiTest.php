<?php

use App\Access\ProjectRole;
use App\Domain\Properties\FieldType;
use App\Http\Resources\WorkItemResource;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
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
