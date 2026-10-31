<?php

use App\Actions\Resolutions\DeleteResolution;
use App\Actions\Resolutions\SaveResolution;
use App\Events\EventType;
use App\Http\Resources\ResolutionResource;
use App\Models\Resolution;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/** The shape of `Resolution` in resources/js/types.ts. */
const RESOLUTION_SHAPE = ['id', 'label', 'default_for', 'position', 'archived_at'];

/** The shipped resolution with this label. */
$shipped = fn (string $label): Resolution => Resolution::query()->where('label', $label)->sole();

/** The resolution as the API answers it. */
$answerOf = fn (Resolution $resolution): array => (new ResolutionResource($resolution->fresh() ?? $resolution))->resolve();

/** The labels that are the default of a category, as `[category => label]`. */
$defaults = fn (): array => Resolution::query()->whereNotNull('default_for')->orderBy('default_for')->pluck('label', 'default_for')->all();

it('lists the resolutions by position', function () {
    $later = Resolution::factory()->create(['label' => 'Veraltet', 'position' => 4]);

    $response = $this->actingAs(User::factory()->create())->getJson('/api/v1/resolutions')->assertOk()
        ->assertJsonStructure(['data' => ['*' => RESOLUTION_SHAPE], 'meta' => ['total']])
        ->assertJsonPath('meta.total', 5);

    expect(array_column($response->json('data'), 'label'))->toBe(['Done', "Won't do", 'Duplicate', 'Cannot reproduce', 'Veraltet'])
        ->and(array_column($response->json('data'), 'default_for'))->toBe(['completed', 'canceled', null, null, null])
        ->and(array_column($response->json('data'), 'position'))->toBe([0, 1, 2, 3, 4])
        ->and($response->json('data.4.id'))->toBe($later->id);
});

it('appends a new resolution and ignores the position it is sent', function () {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/resolutions', ['label' => '  Veraltet  ', 'position' => 0, 'default_for' => null])->assertCreated()
        ->assertJsonStructure(['data' => RESOLUTION_SHAPE])
        ->assertJsonPath('data.label', 'Veraltet')->assertJsonPath('data.position', 4)
        ->assertJsonPath('data.default_for', null)->assertJsonPath('data.archived_at', null);

    $resolution = Resolution::query()->findOrFail($response->json('data.id'));

    expect(Str::isUlid($resolution->id))->toBeTrue()
        ->and(eventsOf(EventType::ResolutionCreated, $resolution)->sole()->changes)->toBe(['label' => ['old' => null, 'new' => 'Veraltet']])
        ->and(eventsOf(EventType::ResolutionUpdated))->toBeEmpty();
});

it('puts the first resolution of an empty list at position 0', function () {
    Resolution::query()->delete();

    $resolution = SaveResolution::run(actor(User::factory()->admin()->create()), null, ['label' => 'Erste']);

    expect($resolution->position)->toBe(0);
});

it('makes a resolution the default of its category and takes the mark from the old one', function () use ($shipped, $answerOf, $defaults) {
    $this->actingAs(User::factory()->admin()->create());
    [$done, $duplicate] = [$shipped('Done'), $shipped('Duplicate')];

    $this->putJson("/api/v1/resolutions/{$duplicate->id}", [...$answerOf($duplicate), 'default_for' => 'completed'])->assertOk()
        ->assertJsonPath('data.default_for', 'completed');

    expect($defaults())->toBe(['canceled' => "Won't do", 'completed' => 'Duplicate'])
        ->and($done->fresh()?->default_for)->toBeNull()
        ->and(eventsOf(EventType::ResolutionUpdated, $done)->sole()->changes)->toBe(['default_for' => ['old' => 'completed', 'new' => null]])
        ->and(eventsOf(EventType::ResolutionUpdated, $duplicate)->sole()->changes)->toBe(['default_for' => ['old' => null, 'new' => 'completed']]);
});

it('lets a new resolution become the default and takes the mark from the old one', function () use ($shipped, $defaults) {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/resolutions', ['label' => 'Erledigt', 'default_for' => 'canceled'])->assertCreated()
        ->assertJsonPath('data.default_for', 'canceled');

    expect($defaults())->toBe(['canceled' => 'Erledigt', 'completed' => 'Done'])
        ->and(eventsOf(EventType::ResolutionUpdated, $shipped("Won't do"))->sole()->changes)->toBe(['default_for' => ['old' => 'canceled', 'new' => null]])
        ->and(eventsOf(EventType::ResolutionCreated, Resolution::query()->findOrFail($response->json('data.id'))))->toHaveCount(1);
});

it('refuses to leave a category without a default', function (array $overrides) use ($shipped, $answerOf, $defaults) {
    $this->actingAs(User::factory()->admin()->create());
    $done = $shipped('Done');

    $response = $this->putJson("/api/v1/resolutions/{$done->id}", [...$answerOf($done), ...$overrides])->assertUnprocessable();

    expect(errorsAt($response, 'default_for'))->toBe([__('field.default_for.last')])
        ->and($defaults())->toBe(['canceled' => "Won't do", 'completed' => 'Done'])
        ->and(eventsOf(EventType::ResolutionUpdated))->toBeEmpty();
})->with([
    'no default at all' => [['default_for' => null]],
    'the other category' => [['default_for' => 'canceled']],
]);

it('refuses to archive a default', function () use ($shipped, $answerOf) {
    $this->actingAs(User::factory()->admin()->create());
    $done = $shipped('Done');
    $url = "/api/v1/resolutions/{$done->id}";

    expect(errorsAt($this->putJson($url, [...$answerOf($done), 'archived_at' => '2000-01-01'])->assertUnprocessable(), 'archived_at'))
        ->toBe([__('field.archived_at.default')]);

    // a new resolution is no exception
    expect(errorsAt($this->postJson('/api/v1/resolutions', ['label' => 'Neu', 'default_for' => 'completed', 'archived_at' => '2000-01-01'])->assertUnprocessable(), 'archived_at'))
        ->toBe([__('field.archived_at.default')])
        ->and($done->fresh()?->archived_at)->toBeNull()
        ->and(Resolution::query()->count())->toBe(4);
});

it('refuses an unknown category', function (mixed $category) {
    $this->actingAs(User::factory()->admin()->create());

    expect(errorsAt($this->postJson('/api/v1/resolutions', ['label' => 'Neu', 'default_for' => $category])->assertUnprocessable(), 'default_for'))
        ->toBe([__('field.default_for.unknown')])
        ->and(Resolution::query()->count())->toBe(4);
})->with(['an unknown one' => ['started'], 'a list' => [['completed']], 'a number' => [3]]);

it('archives and restores a resolution, stamping the time itself', function () use ($shipped, $answerOf) {
    $this->actingAs(User::factory()->admin()->create());
    $duplicate = $shipped('Duplicate');
    $this->travelTo(Carbon::parse('2026-10-31 09:00:00'));
    $url = "/api/v1/resolutions/{$duplicate->id}";

    $archived = $this->putJson($url, [...$answerOf($duplicate), 'archived_at' => '2000-01-01'])->assertOk()->json('data');
    $stamp = now()->toJSON();

    expect($archived['archived_at'])->toBe($stamp);

    // a later save with another stamp leaves the first one
    $this->travel(1)->hour();
    $this->putJson($url, [...$archived, 'archived_at' => '2001-01-01'])->assertOk()->assertJsonPath('data.archived_at', $stamp);
    $this->putJson($url, [...$archived, 'archived_at' => null])->assertOk()->assertJsonPath('data.archived_at', null);

    expect($duplicate->fresh()?->archived_at)->toBeNull()
        ->and(eventsOf(EventType::ResolutionUpdated, $duplicate)->map(fn ($event) => $event->changes)->all())->toBe([
            ['archived_at' => ['old' => null, 'new' => $stamp]],
            ['archived_at' => ['old' => $stamp, 'new' => null]],
        ]);
});

it('renames a resolution', function () use ($shipped, $answerOf) {
    $this->actingAs(User::factory()->admin()->create());
    $duplicate = $shipped('Duplicate');

    $this->putJson("/api/v1/resolutions/{$duplicate->id}", [...$answerOf($duplicate), 'label' => 'Doppelt'])->assertOk()
        ->assertJsonPath('data.label', 'Doppelt')->assertJsonPath('data.position', 2);

    expect(eventsOf(EventType::ResolutionUpdated, $duplicate)->sole()->changes)->toBe(['label' => ['old' => 'Duplicate', 'new' => 'Doppelt']]);
});

it('refuses a label that exists in another case, empty, too long or no text', function (array $overrides, Closure $message) use ($shipped, $answerOf) {
    $this->actingAs(User::factory()->admin()->create());
    $duplicate = $shipped('Duplicate');

    $create = $this->postJson('/api/v1/resolutions', ['label' => 'Neu', ...$overrides])->assertUnprocessable();
    $change = $this->putJson("/api/v1/resolutions/{$duplicate->id}", [...$answerOf($duplicate), ...$overrides])->assertUnprocessable();

    expect(errorsAt($create, 'label'))->toBe([$message()])
        ->and(errorsAt($change, 'label'))->toBe([$message()])
        ->and(Resolution::query()->count())->toBe(4);
})->with([
    'another case' => [['label' => 'DONE'], fn () => __('field.label.taken')],
    'an empty label' => [['label' => ' '], fn () => __('field.label.required')],
    'a label that is no text' => [['label' => ['x']], fn () => __('field.label.invalid')],
    'a label that is too long' => [['label' => str_repeat('a', 61)], fn () => __('field.label.max', ['max' => 60])],
]);

it('records nothing when nothing changes', function () use ($shipped, $answerOf) {
    $this->actingAs(User::factory()->admin()->create());
    $duplicate = $shipped('Duplicate');
    $url = "/api/v1/resolutions/{$duplicate->id}";
    $this->travelTo(Carbon::parse('2026-10-31 09:00:00'));
    $archived = $this->putJson($url, [...$answerOf($duplicate), 'archived_at' => '2000-01-01'])->assertOk()->json('data');
    $done = $shipped('Done');
    $this->travel(5)->minutes();

    // the own answer of an archived resolution: the stamp stays, nothing is written
    $this->putJson($url, $archived)->assertOk()->assertJsonPath('data', $archived);
    $this->putJson("/api/v1/resolutions/{$done->id}", $answerOf($done))->assertOk();

    expect(eventsOf(EventType::ResolutionUpdated))->toHaveCount(1)
        ->and($archived['archived_at'])->not->toBeNull()
        ->and($duplicate->fresh()?->updated_at?->toJSON())->toBe($archived['archived_at'])
        ->and($done->fresh()?->updated_at?->toJSON())->toBe($done->updated_at?->toJSON());
});

it('replaces a resolution as a whole', function () use ($shipped, $answerOf) {
    $this->actingAs(User::factory()->admin()->create());
    [$done, $duplicate] = [$shipped('Done'), $shipped('Duplicate')];

    // without the label
    $input = $answerOf($duplicate);
    unset($input['label']);
    expect(errorsAt($this->putJson("/api/v1/resolutions/{$duplicate->id}", $input)->assertUnprocessable(), 'label'))
        ->toBe([__('field.label.required')]);

    // without `default_for`, a default would end up without a mark: that leaves its category without a default
    $input = $answerOf($done);
    unset($input['default_for']);
    expect(errorsAt($this->putJson("/api/v1/resolutions/{$done->id}", $input)->assertUnprocessable(), 'default_for'))
        ->toBe([__('field.default_for.last')]);

    // a resolution that is no default stays without; a missing `archived_at` is active
    $archived = Resolution::factory()->archived()->create(['label' => 'Alt']);
    $input = $answerOf($archived);
    unset($input['default_for'], $input['archived_at']);
    $this->putJson("/api/v1/resolutions/{$archived->id}", $input)->assertOk()
        ->assertJsonPath('data.default_for', null)->assertJsonPath('data.archived_at', null);
});

it('never deletes a default', function () use ($shipped) {
    $this->actingAs(User::factory()->admin()->create());
    $done = $shipped('Done');
    $canceled = $shipped("Won't do");

    $this->deleteJson("/api/v1/resolutions/{$done->id}")->assertStatus(409)
        ->assertJsonPath('reason', 'is_default')
        ->assertJsonPath('detail', __('problem.detail.default_resolution', ['label' => 'Done', 'category' => 'Completed']));
    $this->deleteJson("/api/v1/resolutions/{$canceled->id}")->assertStatus(409)
        ->assertJsonPath('detail', __('problem.detail.default_resolution', ['label' => "Won't do", 'category' => 'Canceled']));

    expect(Resolution::query()->count())->toBe(4)
        ->and(eventsOf(EventType::ResolutionDeleted))->toBeEmpty();
});

it('deletes an unused resolution', function () use ($shipped) {
    $this->actingAs(User::factory()->admin()->create());
    $duplicate = $shipped('Duplicate');

    $this->deleteJson("/api/v1/resolutions/{$duplicate->id}")->assertOk()->assertExactJson(['outcome' => 'deleted']);

    expect(Resolution::query()->count())->toBe(3)
        ->and(eventsOf(EventType::ResolutionDeleted, $duplicate)->sole()->meta)->toMatchArray(['label' => 'Duplicate']);
});

it('takes a blank archive stamp and a blank category as none, which only an action can receive', function () {
    $admin = User::factory()->admin()->create();

    $resolution = SaveResolution::run(actor($admin), null, ['label' => 'Neu', 'archived_at' => ' ', 'default_for' => ' ']);

    expect($resolution->archived_at)->toBeNull()
        ->and($resolution->default_for)->toBeNull()
        ->and(Resolution::query()->whereNotNull('default_for')->count())->toBe(2);
});

it('lets members read the resolutions and refuses changes', function () use ($shipped) {
    $done = $shipped('Done');
    $denied = __('problem.detail.resolutions_admins_only');

    $this->actingAs(User::factory()->create());

    $this->getJson('/api/v1/resolutions')->assertOk()->assertJsonPath('meta.total', 4);
    $this->postJson('/api/v1/resolutions', ['label' => 'Neu'])->assertForbidden()->assertJsonPath('detail', $denied);
    $this->putJson("/api/v1/resolutions/{$done->id}", ['label' => 'Neu', 'default_for' => 'completed'])->assertForbidden()->assertJsonPath('detail', $denied);
    $this->deleteJson("/api/v1/resolutions/{$done->id}")->assertForbidden()->assertJsonPath('detail', $denied);

    expect(Resolution::query()->count())->toBe(4);
});

it('answers 404 for a resolution deleted meanwhile', function () {
    $admin = User::factory()->admin()->create();
    $resolution = Resolution::factory()->create();
    $resolution->delete();

    expect(problemOf(fn () => SaveResolution::run(actor($admin), $resolution, ['label' => 'Neu']))->status)->toBe(404)
        ->and(problemOf(fn () => DeleteResolution::run(actor($admin), $resolution))->status)->toBe(404)
        ->and(eventsOf(EventType::ResolutionUpdated))->toBeEmpty()
        ->and(eventsOf(EventType::ResolutionDeleted))->toBeEmpty();
});

it('answers an unknown resolution with 404 and no detail', function () {
    $this->actingAs(User::factory()->admin()->create());
    $id = (string) Str::ulid();

    $this->putJson("/api/v1/resolutions/{$id}", ['label' => 'Neu'])->assertNotFound()->assertJsonMissingPath('detail');
    $this->deleteJson("/api/v1/resolutions/{$id}")->assertNotFound()->assertJsonMissingPath('detail');
});
