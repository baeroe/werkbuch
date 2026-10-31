<?php

use App\Actions\WorkItemTypes\DeleteWorkItemType;
use App\Actions\WorkItemTypes\SaveWorkItemType;
use App\Events\EventType;
use App\Http\Resources\WorkItemTypeResource;
use App\Models\Project;
use App\Models\Property;
use App\Models\TypeProperty;
use App\Models\User;
use App\Models\WorkItemType;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/** The shape of `WorkItemType` in resources/js/types.ts. */
const WORK_ITEM_TYPE_SHAPE = ['id', 'name', 'icon', 'tone', 'description', 'is_epic', 'properties', 'archived_at'];

/** A type „Kundenanfrage“ with the given properties. */
$request = fn (array $overrides = []): array => [
    'name' => 'Kundenanfrage',
    'icon' => 'message-square-heart',
    'tone' => 'plum',
    'description' => 'Was Kundinnen und Kunden melden.',
    'is_epic' => false,
    'properties' => [],
    ...$overrides,
];

/** The type as the API answers it. */
$answerOf = fn (WorkItemType $type): array => (new WorkItemTypeResource(WorkItemType::query()->with('typeProperties')->findOrFail($type->id)))->resolve();

it('lists Task, Bug and Epic first, archived types included', function () {
    $archived = WorkItemType::factory()->archived()->create(['name' => 'Alt']);
    $effort = Property::query()->where('key', 'effort')->sole();

    $response = $this->actingAs(User::factory()->create())->getJson('/api/v1/work-item-types')->assertOk()
        ->assertJsonStructure(['data' => ['*' => WORK_ITEM_TYPE_SHAPE], 'meta' => ['total']])
        ->assertJsonPath('meta.total', 4);

    expect(array_column($response->json('data'), 'name'))->toBe(['Task', 'Bug', 'Epic', 'Alt'])
        ->and(array_column($response->json('data'), 'is_epic'))->toBe([false, false, true, false])
        ->and($response->json('data.1'))->toMatchArray(['icon' => 'bug', 'tone' => 'ochre', 'archived_at' => null])
        ->and($response->json('data.1.properties'))->toBe([['property_id' => $effort->id, 'required' => false, 'position' => 0]])
        ->and($response->json('data.3.archived_at'))->toBe($archived->archived_at?->toJSON());
});

it('creates a type with a required property, in the order it is sent', function () use ($request) {
    $customer = Property::factory()->create(['key' => 'customer', 'label' => 'Kunde']);
    $effort = Property::query()->where('key', 'effort')->sole();

    // the ULIDs in capitals: they are stored in lower case all the same
    $response = $this->actingAs(User::factory()->admin()->create())->postJson('/api/v1/work-item-types', $request(['properties' => [
        ['property_id' => strtoupper($customer->id), 'required' => true],
        ['property_id' => strtoupper($effort->id), 'required' => false],
    ]]))->assertCreated()
        ->assertJsonStructure(['data' => WORK_ITEM_TYPE_SHAPE])
        ->assertJsonPath('data.name', 'Kundenanfrage')->assertJsonPath('data.icon', 'message-square-heart')
        ->assertJsonPath('data.tone', 'plum')->assertJsonPath('data.archived_at', null)
        ->assertJsonPath('data.properties', [
            ['property_id' => $customer->id, 'required' => true, 'position' => 0],
            ['property_id' => $effort->id, 'required' => false, 'position' => 1],
        ]);

    $type = WorkItemType::query()->findOrFail($response->json('data.id'));

    expect(Str::isUlid($type->id))->toBeTrue()
        ->and(TypeProperty::query()->where('type_id', $type->id)->orderBy('position')->pluck('property_id')->all())->toBe([$customer->id, $effort->id])
        ->and(eventsOf(EventType::WorkItemTypeCreated, $type)->sole()->changes)->toBe(['name' => ['old' => null, 'new' => 'Kundenanfrage']])
        ->and(eventsOf(EventType::WorkItemTypeUpdated))->toBeEmpty();
});

it('refuses an unknown icon or tone and a property that is missing or twice', function (Closure $change, string $field, Closure $message) use ($request) {
    $effort = Property::query()->where('key', 'effort')->sole();

    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/work-item-types', $change($request(), $effort))->assertUnprocessable();

    expect(errorsAt($response, $field))->toBe([$message()])
        ->and(WorkItemType::query()->count())->toBe(3);
})->with([
    'an unknown icon' => [fn (array $input) => [...$input, 'icon' => 'square'], 'icon', fn () => __('field.icon.unknown')],
    'an icon that is no text' => [fn (array $input) => [...$input, 'icon' => ['bug']], 'icon', fn () => __('field.icon.unknown')],
    'an unknown tone' => [fn (array $input) => [...$input, 'tone' => 'red'], 'tone', fn () => __('field.tone.unknown')],
    'a property that does not exist' => [fn (array $input) => [...$input, 'properties' => [['property_id' => (string) Str::ulid(), 'required' => false]]], 'properties', fn () => __('field.properties.unknown')],
    'a property twice' => [fn (array $input, Property $effort) => [...$input, 'properties' => [
        ['property_id' => $effort->id, 'required' => false],
        ['property_id' => strtoupper($effort->id), 'required' => true],
    ]], 'properties', fn () => __('field.properties.duplicate')],
    'a property without an id' => [fn (array $input) => [...$input, 'properties' => [['required' => false]]], 'properties.0.property_id', fn () => __('field.properties.unknown')],
    'a property without its mark' => [fn (array $input, Property $effort) => [...$input, 'properties' => [['property_id' => $effort->id]]], 'properties.0.required', fn () => __('field.required')],
    'a mark that is no boolean' => [fn (array $input, Property $effort) => [...$input, 'properties' => [['property_id' => $effort->id, 'required' => 'ja']]], 'properties.0.required', fn () => __('field.boolean')],
    'properties that are no list' => [fn (array $input) => [...$input, 'properties' => 'all'], 'properties', fn () => __('field.properties.unknown')],
    'properties keyed by key' => [fn (array $input, Property $effort) => [...$input, 'properties' => ['effort' => ['property_id' => $effort->id, 'required' => false]]], 'properties', fn () => __('field.properties.list')],
    'a name that exists in other capitals' => [fn (array $input) => [...$input, 'name' => 'BUG'], 'name', fn () => __('field.name.taken')],
    'a name that exists with other accents' => [fn (array $input) => [...$input, 'name' => 'Bùg'], 'name', fn () => __('field.name.taken')],
    'an epic mark that is no boolean' => [fn (array $input) => [...$input, 'is_epic' => 'ja'], 'is_epic', fn () => __('field.boolean')],
    'an archive stamp that is no text' => [fn (array $input) => [...$input, 'archived_at' => true], 'archived_at', fn () => __('field.archived_at.invalid')],
]);

it('changes the properties of a type in place: reorders them, requires one, drops one', function () use ($request) {
    $this->actingAs(User::factory()->admin()->create());
    [$a, $b, $c] = Property::factory()->count(3)->create()->all();
    $answer = $this->postJson('/api/v1/work-item-types', $request(['properties' => [
        ['property_id' => $a->id, 'required' => false],
        ['property_id' => $b->id, 'required' => false],
        ['property_id' => $c->id, 'required' => false],
    ]]))->assertCreated()->json('data');
    $type = WorkItemType::query()->findOrFail($answer['id']);
    $rows = TypeProperty::query()->where('type_id', $type->id)->pluck('id', 'property_id')->all();
    $this->travel(5)->minutes();

    $this->putJson("/api/v1/work-item-types/{$type->id}", [...$answer, 'properties' => [
        ['property_id' => $c->id, 'required' => true],
        ['property_id' => $a->id, 'required' => false],
    ]])->assertOk()->assertJsonPath('data.properties', [
        ['property_id' => $c->id, 'required' => true, 'position' => 0],
        ['property_id' => $a->id, 'required' => false, 'position' => 1],
    ]);

    // the rows that stay are the same rows
    expect(TypeProperty::query()->where('type_id', $type->id)->pluck('id', 'property_id')->all())->toEqual([$a->id => $rows[$a->id], $c->id => $rows[$c->id]])
        // only the properties changed, the type changed all the same
        ->and($type->fresh()?->updated_at?->gte($type->updated_at?->copy()->addMinutes(5)))->toBeTrue()
        ->and(eventsOf(EventType::WorkItemTypeUpdated, $type)->sole()->changes)->toBe(['properties' => [
            'old' => [['property_id' => $a->id, 'required' => false], ['property_id' => $b->id, 'required' => false], ['property_id' => $c->id, 'required' => false]],
            'new' => [['property_id' => $c->id, 'required' => true], ['property_id' => $a->id, 'required' => false]],
        ]]);
});

it('archives and restores a type through archived_at, stamping the time itself', function () use ($answerOf) {
    $this->actingAs(User::factory()->admin()->create());
    $bug = WorkItemType::query()->where('name', 'Bug')->sole();
    $this->travelTo(Carbon::parse('2026-10-31 09:00:00'));
    $answer = $answerOf($bug);
    $url = "/api/v1/work-item-types/{$bug->id}";

    $archived = $this->putJson($url, [...$answer, 'archived_at' => '2000-01-01'])->assertOk()->json('data');
    $stamp = now()->toJSON();

    expect($archived['archived_at'])->toBe($stamp);

    // a later save with another stamp leaves the first one
    $this->travel(1)->hour();
    $this->putJson($url, [...$archived, 'archived_at' => '2001-01-01'])->assertOk()->assertJsonPath('data.archived_at', $stamp);
    $this->putJson($url, [...$archived, 'archived_at' => null])->assertOk()->assertJsonPath('data.archived_at', null);

    expect($bug->fresh()?->archived_at)->toBeNull()
        ->and(eventsOf(EventType::WorkItemTypeUpdated, $bug)->map(fn ($event) => $event->changes)->all())->toBe([
            ['archived_at' => ['old' => null, 'new' => $stamp]],
            ['archived_at' => ['old' => $stamp, 'new' => null]],
        ]);
});

it('refuses to archive or delete the default type of a project, naming the project', function () use ($answerOf) {
    $this->actingAs(User::factory()->admin()->create());
    $task = WorkItemType::query()->where('name', 'Task')->sole();
    // by name, not by identifier: Auftritt, Betrieb, Zentrale; archived projects and projects being deleted count too
    Project::factory()->identifier('WEB')->create(['name' => 'Auftritt', 'default_type_id' => $task->id]);
    Project::factory()->identifier('OPS')->archived()->create(['name' => 'Betrieb', 'default_type_id' => $task->id]);
    Project::factory()->identifier('APP')->create(['name' => 'Zentrale', 'default_type_id' => $task->id, 'deleting_at' => now()]);
    $detail = __('problem.detail.default_type', ['projects' => 'WEB, OPS, APP']);

    $this->putJson("/api/v1/work-item-types/{$task->id}", [...$answerOf($task), 'archived_at' => '2026-10-31'])->assertConflict()
        ->assertJsonPath('reason', 'default_type')->assertJsonPath('projects', ['WEB', 'OPS', 'APP'])->assertJsonPath('detail', $detail);
    $this->deleteJson("/api/v1/work-item-types/{$task->id}")->assertConflict()
        ->assertJsonPath('reason', 'default_type')->assertJsonPath('projects', ['WEB', 'OPS', 'APP'])->assertJsonPath('detail', $detail);

    expect($task->fresh()?->archived_at)->toBeNull()
        ->and(eventsOf(EventType::WorkItemTypeUpdated))->toBeEmpty()
        ->and(eventsOf(EventType::WorkItemTypeDeleted))->toBeEmpty();
});

it('saves an archived type unchanged, even when a project holds it as its default', function () use ($answerOf) {
    $this->actingAs(User::factory()->admin()->create());
    $type = WorkItemType::factory()->archived()->create(['name' => 'Alt']);
    // a state no action makes (P11), but data from before may have it: saving archives nothing, so it refuses nothing
    Project::factory()->identifier('WEB')->create(['default_type_id' => $type->id]);
    $answer = $answerOf($type);

    $this->putJson("/api/v1/work-item-types/{$type->id}", $answer)->assertOk()->assertJsonPath('data', $answer);

    expect(eventsOf(EventType::WorkItemTypeUpdated))->toBeEmpty();
});

it('takes a blank archive stamp as active, which only an action can receive', function () use ($request) {
    // over REST, ConvertEmptyStringsToNull makes it null before the rules see it (P29)
    $admin = User::factory()->admin()->create();

    expect(SaveWorkItemType::run(actor($admin), null, $request(['archived_at' => '']))->archived_at)->toBeNull()
        ->and(SaveWorkItemType::run(actor($admin), null, $request(['name' => 'Rückfrage', 'archived_at' => ' ']))->archived_at)->toBeNull();
});

it('deletes an unused type and takes it out of the projects that had it switched on', function () {
    $bug = WorkItemType::query()->where('name', 'Bug')->sole();
    $epic = WorkItemType::query()->where('name', 'Epic')->sole();
    $project = Project::factory()->identifier('WEB')->create();
    $project->types()->sync([$bug->id, $epic->id]);
    // a project without the type is not named
    Project::factory()->identifier('OPS')->create()->types()->detach($epic->id);

    $this->actingAs(User::factory()->admin()->create())->deleteJson("/api/v1/work-item-types/{$epic->id}")
        ->assertOk()->assertExactJson(['outcome' => 'deleted']);

    $event = eventsOf(EventType::WorkItemTypeDeleted, $epic)->sole();

    expect(WorkItemType::query()->whereKey($epic->id)->exists())->toBeFalse()
        ->and($project->types()->pluck('work_item_types.id')->all())->toBe([$bug->id])
        ->and($event->meta['name'])->toBe('Epic')
        ->and($event->meta['projects'])->toBe(['WEB'])
        ->and(eventsOf(EventType::ProjectUpdated))->toBeEmpty();
});

it('replaces a type as a whole', function () use ($answerOf) {
    $this->actingAs(User::factory()->admin()->create());
    $task = WorkItemType::query()->where('name', 'Task')->sole();
    $answer = $answerOf($task);

    foreach (['icon', 'tone', 'is_epic', 'properties'] as $field) {
        $input = $answer;
        unset($input[$field]);

        expect(errorsAt($this->putJson("/api/v1/work-item-types/{$task->id}", $input)->assertUnprocessable(), $field))
            ->toBe([__('field.required')], "without {$field}");
    }

    $archived = WorkItemType::factory()->archived()->create(['description' => 'Alt']);
    $input = $answerOf($archived);
    unset($input['description'], $input['archived_at']);

    $this->putJson("/api/v1/work-item-types/{$archived->id}", $input)->assertOk()
        ->assertJsonPath('data.description', '')->assertJsonPath('data.archived_at', null);

    expect(eventsOf(EventType::WorkItemTypeUpdated, $task))->toBeEmpty()
        ->and(eventsOf(EventType::WorkItemTypeUpdated, $archived)->sole()->changes)->toBe([
            'description' => ['old' => 'Alt', 'new' => ''],
            'archived_at' => ['old' => $archived->archived_at?->toJSON(), 'new' => null],
        ]);
});

it('records nothing when nothing changes', function () use ($request) {
    $this->actingAs(User::factory()->admin()->create());
    $effort = Property::query()->where('key', 'effort')->sole();
    $answer = $this->postJson('/api/v1/work-item-types', $request([
        'properties' => [['property_id' => $effort->id, 'required' => true]],
        'archived_at' => '2000-01-01',
    ]))->assertCreated()->json('data');
    $type = WorkItemType::query()->findOrFail($answer['id']);
    $this->travel(5)->minutes();

    $this->putJson("/api/v1/work-item-types/{$type->id}", $answer)->assertOk()->assertJsonPath('data', $answer);

    expect(eventsOf(EventType::WorkItemTypeUpdated))->toBeEmpty()
        ->and($answer['archived_at'])->not->toBeNull()
        ->and($type->fresh()?->updated_at?->toJSON())->toBe($type->updated_at?->toJSON())
        // a write now would stamp the time five minutes on
        ->and(TypeProperty::query()->where('type_id', $type->id)->where('updated_at', '>', now()->subMinute())->exists())->toBeFalse();
});

it('lets members read the types and refuses changes', function () use ($request) {
    $bug = WorkItemType::query()->where('name', 'Bug')->sole();
    $denied = __('problem.detail.types_admins_only');

    $this->actingAs(User::factory()->create());

    $this->getJson('/api/v1/work-item-types')->assertOk()->assertJsonPath('meta.total', 3);
    $this->postJson('/api/v1/work-item-types', $request())->assertForbidden()->assertJsonPath('detail', $denied);
    $this->putJson("/api/v1/work-item-types/{$bug->id}", $request())->assertForbidden()->assertJsonPath('detail', $denied);
    $this->deleteJson("/api/v1/work-item-types/{$bug->id}")->assertForbidden()->assertJsonPath('detail', $denied);

    expect(WorkItemType::query()->count())->toBe(3);
});

it('answers 404 for a type deleted meanwhile', function () use ($request) {
    $admin = User::factory()->admin()->create();
    $effort = Property::query()->where('key', 'effort')->sole();
    $type = SaveWorkItemType::run(actor($admin), null, $request(['properties' => [['property_id' => $effort->id, 'required' => false]]]));
    $input = $request(['name' => 'Neu']);
    $type->delete();

    expect(problemOf(fn () => SaveWorkItemType::run(actor($admin), $type, $input))->status)->toBe(404)
        ->and(problemOf(fn () => DeleteWorkItemType::run(actor($admin), $type))->status)->toBe(404)
        ->and(TypeProperty::query()->where('type_id', $type->id)->exists())->toBeFalse()
        ->and(eventsOf(EventType::WorkItemTypeUpdated))->toBeEmpty()
        ->and(eventsOf(EventType::WorkItemTypeDeleted))->toBeEmpty();
});

it('answers an unknown type with 404 and no detail', function () use ($request) {
    $this->actingAs(User::factory()->admin()->create());
    $id = (string) Str::ulid();

    $this->putJson("/api/v1/work-item-types/{$id}", $request())->assertNotFound()->assertJsonMissingPath('detail');
    $this->deleteJson("/api/v1/work-item-types/{$id}")->assertNotFound()->assertJsonMissingPath('detail');
});
