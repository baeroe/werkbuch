<?php

use App\Events\EventType;
use App\Models\User;
use App\Models\View;

/** The shape of `View` in resources/js/types.ts. */
const VIEW_SHAPE = ['id', 'name', 'icon', 'filter', 'display', 'created_by', 'created_at', 'updated_at'];

$input = fn (array $overrides = []): array => [
    'name' => 'Diese Woche fällig',
    'icon' => 'calendar-clock',
    'filter' => ['version' => 1, 'conditions' => [['field' => 'due_date', 'op' => 'is', 'value' => 'this_week']]],
    'display' => ['layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'due_date', 'direction' => 'asc'], 'fields' => ['key', 'title', 'due_date'], 'show_sub_items' => true],
    ...$overrides,
];

it('creates, shows, lists, replaces and deletes a view', function () use ($input) {
    $ida = User::factory()->create();
    $this->actingAs($ida);

    $created = $this->postJson('/api/v1/views', $input())->assertCreated()->assertJsonStructure(['data' => VIEW_SHAPE])
        ->assertJsonPath('data.name', 'Diese Woche fällig')->assertJsonPath('data.created_by', $ida->id);
    $id = $created->json('data.id');

    $this->getJson("/api/v1/views/{$id}")->assertOk()->assertJsonPath('data', $created->json('data'));
    $this->getJson('/api/v1/views')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $id);

    $this->putJson("/api/v1/views/{$id}", $input(['name' => 'Bald fällig']))->assertOk()->assertJsonPath('data.name', 'Bald fällig');
    $this->deleteJson("/api/v1/views/{$id}")->assertNoContent();
    $this->getJson("/api/v1/views/{$id}")->assertNotFound();

    expect(View::query()->count())->toBe(0);
});

it('takes its own answer back as a replacement that changes nothing', function () use ($input) {
    $this->actingAs(User::factory()->create());
    $data = $this->postJson('/api/v1/views', $input())->assertCreated()->json('data');

    $this->travel(1)->minutes();
    $this->putJson("/api/v1/views/{$data['id']}", $data)->assertOk()->assertJsonPath('data', $data);

    expect(eventsOf(EventType::ViewUpdated)->count())->toBe(0);
});

it('answers the fields of an invalid view as 422', function () use ($input) {
    $this->actingAs(User::factory()->create())
        ->postJson('/api/v1/views', $input(['name' => '', 'filter' => ['version' => 2, 'conditions' => []]]))
        ->assertUnprocessable()
        ->assertJsonPath('errors.name.0', __('field.name.required'))
        ->assertJsonPath('errors.filter.0', __('field.filter.shape'));
});

it('finds a view by its ULID in any case, and nothing else', function () {
    $view = View::factory()->create();
    $this->actingAs(User::factory()->create());

    $this->getJson('/api/v1/views/'.strtoupper($view->id))->assertOk()->assertJsonPath('data.id', $view->id);
    $this->getJson('/api/v1/views/v_due_week')->assertNotFound();
    $this->getJson('/api/v1/views/01jzzzzzzzzzzzzzzzzzzzzzzz')->assertNotFound();
});

it('lets a token that only reads read the views, not create one', function () use ($input) {
    $view = View::factory()->create();
    $token = apiToken(User::factory()->create(), ['read']);

    $this->withToken($token)->getJson('/api/v1/views')->assertOk()->assertJsonPath('meta.total', 1);
    $this->withToken($token)->getJson("/api/v1/views/{$view->id}")->assertOk();
    $this->withToken($token)->postJson('/api/v1/views', $input())->assertForbidden();

    expect(View::query()->count())->toBe(1);
});

it('keeps per_page in links.next of the list', function () {
    $ida = User::factory()->create();
    View::factory()->count(3)->create(['created_by' => $ida->id]);

    $first = $this->actingAs($ida)->getJson('/api/v1/views?per_page=1')->assertOk();
    $next = $first->json('links.next');

    expect($next)->toContain('per_page=1')
        ->and($this->actingAs($ida)->getJson($next)->assertOk()->json('data'))->toHaveCount(1);
});
