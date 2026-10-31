<?php

use App\Actions\RelationTypes\DeleteRelationType;
use App\Actions\RelationTypes\SaveRelationType;
use App\Events\EventType;
use App\Http\Resources\RelationTypeResource;
use App\Models\RelationType;
use App\Models\User;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/** The shape of `RelationType` in resources/js/types.ts. */
const RELATION_TYPE_SHAPE = ['id', 'name', 'outward_label', 'inward_label', 'built_in'];

/** A relation type „testet“ with a label for each direction. */
$input = fn (array $overrides = []): array => ['name' => 'testet', 'outward_label' => 'testet', 'inward_label' => 'wird getestet von', ...$overrides];

it('lists the built-in types first with blocks and is blocked by', function () {
    $own = RelationType::factory()->create(['name' => 'Eigener']);

    $response = $this->actingAs(User::factory()->create())->getJson('/api/v1/relation-types')->assertOk()
        ->assertJsonStructure(['data' => ['*' => RELATION_TYPE_SHAPE], 'meta' => ['total']])
        ->assertJsonPath('meta.total', 4);

    expect(array_column($response->json('data'), 'built_in'))->toBe(['blocks', 'duplicates', 'relates', null])
        ->and($response->json('data.0'))->toMatchArray(['outward_label' => 'blocks', 'inward_label' => 'is blocked by'])
        ->and($response->json('data.2.inward_label'))->toBeNull()
        ->and($response->json('data.3.id'))->toBe($own->id);
});

it('creates a type with a label for each direction', function () use ($input) {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/relation-types', $input(['name' => '  Testet  ']))->assertCreated()
        ->assertJsonStructure(['data' => RELATION_TYPE_SHAPE])
        ->assertJsonPath('data.name', 'Testet')->assertJsonPath('data.outward_label', 'testet')
        ->assertJsonPath('data.inward_label', 'wird getestet von')->assertJsonPath('data.built_in', null);

    $type = RelationType::query()->findOrFail($response->json('data.id'));

    expect(Str::isUlid($type->id))->toBeTrue()
        ->and(eventsOf(EventType::RelationTypeCreated, $type)->sole()->changes)->toBe(['name' => ['old' => null, 'new' => 'Testet']])
        ->and(eventsOf(EventType::RelationTypeUpdated))->toBeEmpty();
});

it('creates a symmetric type with a null inward label', function (array $overrides) use ($input) {
    $this->actingAs(User::factory()->admin()->create());

    // an empty text is `null` by the time it reaches the action (ConvertEmptyStringsToNull)
    $this->postJson('/api/v1/relation-types', $input($overrides))->assertCreated()
        ->assertJsonPath('data.inward_label', null);

    expect(RelationType::query()->where('name', 'testet')->sole()->inward_label)->toBeNull();
})->with([
    'null' => [['inward_label' => null]],
    'empty' => [['inward_label' => '']],
    'blank' => [['inward_label' => '   ']],
]);

it('refuses an empty inward label, which only an action can receive', function (string $blank) use ($input) {
    $admin = User::factory()->admin()->create();

    $outcome = null;

    try {
        SaveRelationType::run(actor($admin), null, $input(['inward_label' => $blank]));
    } catch (ValidationException $exception) {
        $outcome = $exception;
    }

    // without the rule a type with an empty opposite direction would exist
    expect($outcome)->toBeInstanceOf(ValidationException::class);
    assert($outcome instanceof ValidationException);
    expect($outcome->errors())->toBe(['inward_label' => [__('field.inward_label.required')]])
        ->and(RelationType::query()->where('name', 'testet')->exists())->toBeFalse();
})->with(['empty' => [''], 'blank' => ['  ']]);

it('refuses a name that exists in another case and labels that are missing, too long or no text', function (array $overrides, string $field, Closure $message) use ($input) {
    RelationType::factory()->create(['name' => 'Prüfung']);
    $other = RelationType::factory()->create(['name' => 'Alt']);
    $this->actingAs(User::factory()->admin()->create());

    $create = $this->postJson('/api/v1/relation-types', $input($overrides))->assertUnprocessable();
    $change = $this->putJson("/api/v1/relation-types/{$other->id}", $input($overrides))->assertUnprocessable();

    expect(errorsAt($create, $field))->toBe([$message()])
        ->and(errorsAt($change, $field))->toBe([$message()])
        ->and(RelationType::query()->count())->toBe(5);
})->with([
    'a name in another case' => [['name' => 'PRÜFUNG'], 'name', fn () => __('field.name.taken')],
    'an empty name' => [['name' => ' '], 'name', fn () => __('field.name.required')],
    'an empty direction' => [['outward_label' => ' '], 'outward_label', fn () => __('field.outward_label.required')],
    'a direction that is no text' => [['outward_label' => ['x']], 'outward_label', fn () => __('field.outward_label.invalid')],
    'a direction that is too long' => [['outward_label' => str_repeat('a', 61)], 'outward_label', fn () => __('field.outward_label.max', ['max' => 60])],
    'an opposite direction that is no text' => [['inward_label' => ['x']], 'inward_label', fn () => __('field.inward_label.invalid')],
    'an opposite direction that is too long' => [['inward_label' => str_repeat('a', 61)], 'inward_label', fn () => __('field.inward_label.max', ['max' => 60])],
]);

it('renames a built-in type but keeps it built in', function () use ($input) {
    $this->actingAs(User::factory()->admin()->create());
    $blocks = RelationType::query()->where('built_in', 'blocks')->sole();

    $this->putJson("/api/v1/relation-types/{$blocks->id}", $input([
        'name' => 'Hemmt', 'outward_label' => 'hemmt', 'inward_label' => 'wird gehemmt von', 'built_in' => null,
    ]))->assertOk()->assertJsonPath('data.name', 'Hemmt')->assertJsonPath('data.built_in', 'blocks');

    // an own type does not become built in by asking for it
    $own = $this->postJson('/api/v1/relation-types', $input(['built_in' => 'relates']))->assertCreated()
        ->assertJsonPath('data.built_in', null)->json('data.id');

    expect($blocks->fresh()?->built_in)->toBe('blocks')
        ->and(RelationType::query()->findOrFail($own)->built_in)->toBeNull()
        ->and(eventsOf(EventType::RelationTypeUpdated, $blocks)->sole()->changes)->toBe([
            'name' => ['old' => 'blocks', 'new' => 'Hemmt'],
            'outward_label' => ['old' => 'blocks', 'new' => 'hemmt'],
            'inward_label' => ['old' => 'is blocked by', 'new' => 'wird gehemmt von'],
        ]);
});

it('makes a type symmetric and gives it a direction back', function () use ($input) {
    $this->actingAs(User::factory()->admin()->create());
    $type = RelationType::factory()->create(['name' => 'Testet', 'outward_label' => 'testet', 'inward_label' => 'wird getestet von']);
    $url = "/api/v1/relation-types/{$type->id}";

    $this->putJson($url, $input(['name' => 'Testet', 'inward_label' => null]))->assertOk()->assertJsonPath('data.inward_label', null);
    $this->putJson($url, $input(['name' => 'Testet']))->assertOk()->assertJsonPath('data.inward_label', 'wird getestet von');

    expect(eventsOf(EventType::RelationTypeUpdated, $type)->map(fn ($event) => $event->changes)->all())->toBe([
        ['inward_label' => ['old' => 'wird getestet von', 'new' => null]],
        ['inward_label' => ['old' => null, 'new' => 'wird getestet von']],
    ]);
});

it('never deletes a built-in type', function () {
    $this->actingAs(User::factory()->admin()->create());
    $relates = RelationType::query()->where('built_in', 'relates')->sole();

    $this->deleteJson("/api/v1/relation-types/{$relates->id}")->assertStatus(409)
        ->assertJsonPath('reason', 'built_in')
        ->assertJsonPath('detail', __('problem.detail.built_in', ['name' => $relates->name]));

    expect($relates->fresh())->not->toBeNull()
        ->and(eventsOf(EventType::RelationTypeDeleted))->toBeEmpty();
});

it('deletes an own type and answers how many relations went with it', function () {
    $this->actingAs(User::factory()->admin()->create());
    $type = RelationType::factory()->create(['name' => 'Eigener']);

    $this->deleteJson("/api/v1/relation-types/{$type->id}")->assertOk()->assertExactJson(['affected_relations' => 0]);

    expect(RelationType::query()->count())->toBe(3)
        ->and(eventsOf(EventType::RelationTypeDeleted, $type)->sole()->meta)->toMatchArray(['name' => 'Eigener']);
});

it('records nothing when nothing changes', function () {
    $this->actingAs(User::factory()->admin()->create());
    $type = RelationType::factory()->create(['name' => 'Eigener']);
    $answer = (new RelationTypeResource($type))->resolve();
    $this->travel(5)->minutes();

    $this->putJson("/api/v1/relation-types/{$type->id}", $answer)->assertOk()->assertJsonPath('data', $answer);

    expect(eventsOf(EventType::RelationTypeUpdated))->toBeEmpty()
        ->and($type->fresh()?->updated_at?->toJSON())->toBe($type->updated_at?->toJSON());
});

it('replaces a relation type as a whole', function () {
    $this->actingAs(User::factory()->admin()->create());
    $type = RelationType::factory()->create(['name' => 'Eigener']);
    $url = "/api/v1/relation-types/{$type->id}";

    expect(errorsAt($this->putJson($url, ['outward_label' => 'testet', 'inward_label' => 'x'])->assertUnprocessable(), 'name'))
        ->toBe([__('field.name.required')])
        ->and(errorsAt($this->putJson($url, ['name' => 'Eigener', 'inward_label' => 'x'])->assertUnprocessable(), 'outward_label'))
        ->toBe([__('field.outward_label.required')]);

    // without `inward_label` the relation is symmetric
    $this->putJson($url, ['name' => 'Eigener', 'outward_label' => 'testet'])->assertOk()->assertJsonPath('data.inward_label', null);
});

it('lets members read the relation types and refuses changes', function () use ($input) {
    $type = RelationType::factory()->create();
    $denied = __('problem.detail.relation_types_admins_only');

    $this->actingAs(User::factory()->create());

    $this->getJson('/api/v1/relation-types')->assertOk()->assertJsonPath('meta.total', 4);
    $this->postJson('/api/v1/relation-types', $input())->assertForbidden()->assertJsonPath('detail', $denied);
    $this->putJson("/api/v1/relation-types/{$type->id}", $input())->assertForbidden()->assertJsonPath('detail', $denied);
    $this->deleteJson("/api/v1/relation-types/{$type->id}")->assertForbidden()->assertJsonPath('detail', $denied);

    expect(RelationType::query()->count())->toBe(4);
});

it('answers 404 for a relation type deleted meanwhile', function () use ($input) {
    $admin = User::factory()->admin()->create();
    $type = RelationType::factory()->create();
    $type->delete();

    expect(problemOf(fn () => SaveRelationType::run(actor($admin), $type, $input()))->status)->toBe(404)
        ->and(problemOf(fn () => DeleteRelationType::run(actor($admin), $type))->status)->toBe(404)
        ->and(eventsOf(EventType::RelationTypeUpdated))->toBeEmpty()
        ->and(eventsOf(EventType::RelationTypeDeleted))->toBeEmpty();
});

it('answers an unknown relation type with 404 and no detail', function () use ($input) {
    $this->actingAs(User::factory()->admin()->create());
    $id = (string) Str::ulid();

    $this->putJson("/api/v1/relation-types/{$id}", $input())->assertNotFound()->assertJsonMissingPath('detail');
    $this->deleteJson("/api/v1/relation-types/{$id}")->assertNotFound()->assertJsonMissingPath('detail');
});
