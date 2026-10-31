<?php

use App\Actions\Labels\DeleteLabel;
use App\Actions\Labels\SaveLabel;
use App\Events\EventType;
use App\Http\Resources\LabelResource;
use App\Models\Label;
use App\Models\User;
use Illuminate\Support\Str;

/** The shape of `Label` in resources/js/types.ts. */
const LABEL_SHAPE = ['id', 'name', 'color'];

it('lists the labels in the order they were made in', function () {
    $ux = Label::factory()->create(['name' => 'UX']);
    $later = Label::factory()->create(['name' => 'Backend']);

    $response = $this->actingAs(User::factory()->create())->getJson('/api/v1/labels')->assertOk()
        ->assertJsonStructure(['data' => ['*' => LABEL_SHAPE], 'meta' => ['total']])
        ->assertJsonPath('meta.total', 2);

    expect(array_column($response->json('data'), 'id'))->toBe([$ux->id, $later->id]);
});

it('creates a label and records it', function () {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/labels', ['name' => '  Kundenwunsch  ', 'color' => 'plum'])->assertCreated()
        ->assertJsonStructure(['data' => LABEL_SHAPE])
        ->assertJsonPath('data.name', 'Kundenwunsch')->assertJsonPath('data.color', 'plum');

    $label = Label::query()->findOrFail($response->json('data.id'));

    expect(Str::isUlid($label->id))->toBeTrue()
        ->and(eventsOf(EventType::LabelCreated, $label)->sole()->changes)->toBe([
            'name' => ['old' => null, 'new' => 'Kundenwunsch'],
            'color' => ['old' => null, 'new' => 'plum'],
        ])
        ->and(eventsOf(EventType::LabelUpdated))->toBeEmpty();
});

it('renames a label and changes its colour, one event for each change', function () {
    $this->actingAs(User::factory()->admin()->create());
    $label = Label::factory()->create(['name' => 'UX', 'color' => 'sand']);
    $url = "/api/v1/labels/{$label->id}";

    $this->putJson($url, ['name' => 'Design', 'color' => 'sand'])->assertOk()->assertJsonPath('data.name', 'Design');
    $this->putJson($url, ['name' => 'Design', 'color' => 'sky'])->assertOk()->assertJsonPath('data.color', 'sky');

    expect($label->fresh()?->color->value)->toBe('sky')
        ->and(eventsOf(EventType::LabelUpdated, $label)->map(fn ($event) => $event->changes)->all())->toBe([
            ['name' => ['old' => 'UX', 'new' => 'Design']],
            ['color' => ['old' => 'sand', 'new' => 'sky']],
        ]);
});

it('refuses a name that exists in another case and a tone that does not exist', function (array $input, string $field, Closure $message) {
    Label::factory()->create(['name' => 'Prüfung']);
    $other = Label::factory()->create(['name' => 'Alt']);
    $this->actingAs(User::factory()->admin()->create());

    $create = $this->postJson('/api/v1/labels', ['name' => 'Neu', 'color' => 'sky', ...$input])->assertUnprocessable();
    $change = $this->putJson("/api/v1/labels/{$other->id}", ['name' => 'Alt', 'color' => 'sky', ...$input])->assertUnprocessable();

    expect(errorsAt($create, $field))->toBe([$message()])
        ->and(errorsAt($change, $field))->toBe([$message()])
        ->and(Label::query()->count())->toBe(2);
})->with([
    'a name in another case' => [['name' => 'PRÜFUNG'], 'name', fn () => __('field.name.taken')],
    'a name without accents' => [['name' => 'Prufung'], 'name', fn () => __('field.name.taken')],
    'an empty name' => [['name' => '  '], 'name', fn () => __('field.name.required')],
    'a name that is no text' => [['name' => ['x']], 'name', fn () => __('field.name.invalid')],
    'a name that is too long' => [['name' => str_repeat('a', 61)], 'name', fn () => __('field.name.max', ['max' => 60])],
    'an unknown tone' => [['color' => 'neon'], 'color', fn () => __('field.color.unknown')],
    'a tone that is no text' => [['color' => ['sky']], 'color', fn () => __('field.color.unknown')],
]);

it('keeps the own name when a label is saved again', function () {
    $this->actingAs(User::factory()->admin()->create());
    $label = Label::factory()->create(['name' => 'UX']);

    $this->putJson("/api/v1/labels/{$label->id}", ['name' => 'ux', 'color' => 'moss'])->assertOk()
        ->assertJsonPath('data.name', 'ux');
});

it('deletes a label and answers how many items had it', function () {
    $this->actingAs(User::factory()->admin()->create());
    $label = Label::factory()->create(['name' => 'UX']);

    $this->deleteJson("/api/v1/labels/{$label->id}")->assertOk()->assertExactJson(['affected_items' => 0]);

    expect(Label::query()->count())->toBe(0)
        ->and(eventsOf(EventType::LabelDeleted, $label)->sole()->meta)->toMatchArray(['name' => 'UX']);
});

it('records nothing when nothing changes', function () {
    $this->actingAs(User::factory()->admin()->create());
    $label = Label::factory()->create(['name' => 'UX', 'color' => 'moss']);
    $answer = (new LabelResource($label))->resolve();
    $this->travel(5)->minutes();

    $this->putJson("/api/v1/labels/{$label->id}", $answer)->assertOk()->assertJsonPath('data', $answer);

    expect(eventsOf(EventType::LabelUpdated))->toBeEmpty()
        ->and($label->fresh()?->updated_at?->toJSON())->toBe($label->updated_at?->toJSON());
});

it('replaces a label as a whole', function () {
    $this->actingAs(User::factory()->admin()->create());
    $label = Label::factory()->create(['name' => 'UX', 'color' => 'moss']);

    foreach (['name', 'color'] as $field) {
        $input = ['name' => 'UX', 'color' => 'moss'];
        unset($input[$field]);

        expect(errorsAt($this->putJson("/api/v1/labels/{$label->id}", $input)->assertUnprocessable(), $field))
            ->toBe([$field === 'name' ? __('field.name.required') : __('field.required')], "without {$field}");
    }

    expect(eventsOf(EventType::LabelUpdated))->toBeEmpty();
});

it('lets members read the labels and refuses changes', function () {
    $label = Label::factory()->create();
    $denied = __('problem.detail.labels_admins_only');

    $this->actingAs(User::factory()->create());

    $this->getJson('/api/v1/labels')->assertOk()->assertJsonPath('meta.total', 1);
    $this->postJson('/api/v1/labels', ['name' => 'Neu', 'color' => 'sky'])->assertForbidden()->assertJsonPath('detail', $denied);
    $this->putJson("/api/v1/labels/{$label->id}", ['name' => 'Neu', 'color' => 'sky'])->assertForbidden()->assertJsonPath('detail', $denied);
    $this->deleteJson("/api/v1/labels/{$label->id}")->assertForbidden()->assertJsonPath('detail', $denied);

    expect(Label::query()->count())->toBe(1);
});

it('answers 404 for a label deleted meanwhile', function () {
    $admin = User::factory()->admin()->create();
    $label = Label::factory()->create();
    $label->delete();

    expect(problemOf(fn () => SaveLabel::run(actor($admin), $label, ['name' => 'Neu', 'color' => 'sky']))->status)->toBe(404)
        ->and(problemOf(fn () => DeleteLabel::run(actor($admin), $label))->status)->toBe(404)
        ->and(eventsOf(EventType::LabelUpdated))->toBeEmpty()
        ->and(eventsOf(EventType::LabelDeleted))->toBeEmpty();
});

it('answers an unknown label with 404 and no detail', function () {
    $this->actingAs(User::factory()->admin()->create());
    $id = (string) Str::ulid();

    $this->putJson("/api/v1/labels/{$id}", ['name' => 'Neu', 'color' => 'sky'])->assertNotFound()->assertJsonMissingPath('detail');
    $this->deleteJson("/api/v1/labels/{$id}")->assertNotFound()->assertJsonMissingPath('detail');
});
