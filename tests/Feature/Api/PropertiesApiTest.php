<?php

use App\Actions\Properties\DeleteProperty;
use App\Actions\Properties\SaveProperty;
use App\Domain\Catalog\Tone;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Property;
use App\Models\PropertyOption;
use App\Models\TypeProperty;
use App\Models\User;
use App\Models\WorkItemType;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Illuminate\Validation\ValidationException;

/** The shape of `Property` in resources/js/types.ts. */
const PROPERTY_SHAPE = ['id', 'key', 'label', 'field_type', 'help', 'default_value', 'settings', 'options'];

/** The messages of the response at one field (paths with dots such as `options.1.label` are keys of `errors`). */
$errorsAt = fn (TestResponse $response, string $field): ?array => $response->json('errors')[$field] ?? null;

/** The Problem a call ends with. */
$problemOf = function (Closure $call): Problem {
    try {
        $call();
    } catch (Problem $problem) {
        return $problem;
    }

    throw new RuntimeException('The call went through.');
};

/** The field messages a call ends with. */
$invalidOf = function (Closure $call): array {
    try {
        $call();
    } catch (ValidationException $exception) {
        return $exception->errors();
    }

    throw new RuntimeException('The call went through.');
};

/** A dropdown „Browser“ with the options Chrome (`opt_a`) and Firefox (`opt_b`), single choice, no default. */
$browser = fn (array $overrides = []): array => [
    'key' => 'browser',
    'label' => 'Browser',
    'field_type' => 'dropdown',
    'help' => 'Wo tritt es auf?',
    'settings' => ['multiple' => false],
    'options' => [
        ['id' => 'opt_a', 'label' => 'Chrome', 'color' => 'sky'],
        ['id' => 'opt_b', 'label' => 'Firefox', 'color' => 'ochre'],
    ],
    'default_value' => null,
    ...$overrides,
];

/** A property of the field type with the settings it needs, the two options of $browser for a dropdown and a default. */
$probe = fn (string $type, bool $multiple, mixed $default): array => [
    'key' => 'probe',
    'label' => 'Probe',
    'field_type' => $type,
    'settings' => match ($type) {
        'number' => ['decimals' => 1],
        'dropdown', 'member' => ['multiple' => $multiple],
        default => [],
    },
    'options' => $type === 'dropdown' ? [
        ['id' => 'opt_a', 'label' => 'Chrome', 'color' => 'sky'],
        ['id' => 'opt_b', 'label' => 'Firefox', 'color' => 'ochre'],
    ] : [],
    'default_value' => $default,
];

it('lists the properties with their options in order, settings as an object', function () {
    $priority = Property::factory()->create(['key' => 'urgency', 'label' => 'Dringlichkeit', 'field_type' => 'dropdown', 'settings' => ['multiple' => false]]);
    // made in the other order: the list follows the position
    $low = $priority->options()->create(['label' => 'Niedrig', 'color' => Tone::Slate, 'position' => 1]);
    $high = $priority->options()->create(['label' => 'Hoch', 'color' => Tone::Plum, 'position' => 0, 'archived_at' => now()]);
    $text = Property::factory()->create(['key' => 'customer', 'label' => 'Kunde']);

    $response = $this->actingAs(User::factory()->create())->getJson('/api/v1/properties')->assertOk()
        ->assertJsonStructure(['data' => ['*' => PROPERTY_SHAPE], 'meta' => ['total']])
        ->assertJsonPath('meta.total', 3);

    expect(array_column($response->json('data'), 'key'))->toBe(['effort', 'urgency', 'customer'])
        ->and($response->json('data.0'))->toMatchArray([
            'field_type' => 'number', 'label' => __('catalog.builtin.property.effort.label'), 'default_value' => null, 'settings' => ['decimals' => 1], 'options' => [],
        ])
        ->and($response->json('data.1.options'))->toBe([
            ['id' => $high->id, 'label' => 'Hoch', 'color' => 'plum', 'position' => 0, 'archived_at' => $high->archived_at?->toJSON()],
            ['id' => $low->id, 'label' => 'Niedrig', 'color' => 'slate', 'position' => 1, 'archived_at' => null],
        ])
        // an object also when empty; the settings without the cast would come out as a list
        ->and($response->getContent())->toContain('"settings":{"decimals":1}')->toContain('"settings":{}')
        ->and(json_encode($text->settings))->toBe('[]');
});

it('creates a dropdown with options and a default among them, giving the new options ids', function () use ($browser) {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/properties', $browser(['default_value' => 'opt_b']))->assertCreated()
        ->assertJsonStructure(['data' => PROPERTY_SHAPE])
        ->assertJsonPath('data.key', 'browser')->assertJsonPath('data.field_type', 'dropdown')
        ->assertJsonPath('data.help', 'Wo tritt es auf?')->assertJsonPath('data.settings', ['multiple' => false]);

    $options = $response->json('data.options');
    $property = Property::query()->findOrFail($response->json('data.id'));

    expect(array_column($options, 'label'))->toBe(['Chrome', 'Firefox'])
        ->and(array_column($options, 'color'))->toBe(['sky', 'ochre'])
        ->and(array_column($options, 'position'))->toBe([0, 1])
        ->and(array_filter(array_column($options, 'id'), fn (string $id) => ! Str::isUlid($id)))->toBe([])
        ->and($response->json('data.default_value'))->toBe($options[1]['id'])
        ->and($property->default_value)->toBe($options[1]['id'])
        ->and(eventsOf(EventType::PropertyCreated, $property)->sole()->changes)->toBe([
            'key' => ['old' => null, 'new' => 'browser'],
            'label' => ['old' => null, 'new' => 'Browser'],
        ])
        ->and(eventsOf(EventType::PropertyUpdated))->toBeEmpty();
});

it('refuses a key of a core field, a malformed key and a key that exists', function (string $key, string $message) use ($errorsAt, $browser) {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/properties', $browser(['key' => $key]))->assertUnprocessable();

    expect($errorsAt($response, 'key'))->toBe([__($message)])
        ->and(Property::query()->count())->toBe(1);
})->with([
    'the core field title' => ['title', 'field.key.core'],
    'the core field labels' => ['labels', 'field.key.core'],
    'capitals' => ['Title', 'field.key.format'],
    'a digit first' => ['1x', 'field.key.format'],
    '41 characters' => [str_repeat('k', 41), 'field.key.format'],
    'a key that exists' => ['effort', 'field.key.taken'],
]);

it('refuses a key with a line break, which only an action can receive', function () use ($invalidOf, $browser, $probe) {
    // over REST, TrimStrings takes the line break away before the rules see it (P29)
    $admin = User::factory()->admin()->create();

    expect($invalidOf(fn () => SaveProperty::run(actor($admin), null, $browser(['key' => "customer\n"]))))
        ->toBe(['key' => [__('field.key.format')]])
        ->and($invalidOf(fn () => SaveProperty::run(actor($admin), null, $probe('date', false, "2026-10-31\n"))))
        ->toBe(['default_value' => [__('field.default_value.date')]])
        ->and(Property::query()->count())->toBe(1);
});

it('keeps key and field type once saved, only single may become multiple choice', function () use ($errorsAt, $browser) {
    $this->actingAs(User::factory()->admin()->create());
    $answer = $this->postJson('/api/v1/properties', $browser(['default_value' => 'opt_a']))->assertCreated()->json('data');
    $chrome = $answer['options'][0]['id'];
    $url = "/api/v1/properties/{$answer['id']}";

    expect($errorsAt($this->putJson($url, [...$answer, 'key' => 'browsers'])->assertUnprocessable(), 'key'))->toBe([__('field.key.immutable')])
        ->and($errorsAt($this->putJson($url, [...$answer, 'field_type' => 'member'])->assertUnprocessable(), 'field_type'))
        ->toBe([__('field.field_type.immutable')])
        ->and(eventsOf(EventType::PropertyUpdated))->toBeEmpty();

    $multiple = $this->putJson($url, [...$answer, 'settings' => ['multiple' => true]])->assertOk()
        ->assertJsonPath('data.settings', ['multiple' => true])->assertJsonPath('data.default_value', [$chrome])->json('data');

    expect(eventsOf(EventType::PropertyUpdated)->sole()->changes)->toBe([
        'default_value' => ['old' => $chrome, 'new' => [$chrome]],
        'settings' => ['old' => ['multiple' => false], 'new' => ['multiple' => true]],
    ])
        ->and($errorsAt($this->putJson($url, [...$multiple, 'settings' => ['multiple' => false]])->assertUnprocessable(), 'settings.multiple'))
        ->toBe([__('field.settings.multiple_back')])
        ->and(Property::query()->findOrFail($answer['id'])->settings)->toBe(['multiple' => true]);
});

it('replaces a property as a whole', function () use ($errorsAt, $browser) {
    $this->actingAs(User::factory()->admin()->create());
    $effort = Property::query()->where('key', 'effort')->sole();
    $answer = $this->getJson('/api/v1/properties')->json('data.0');
    $dropdown = $this->postJson('/api/v1/properties', $browser())->assertCreated()->json('data');
    $without = function (array $input, string $path): array {
        Arr::forget($input, $path);

        return $input;
    };

    foreach (['key', 'field_type', 'label'] as $field) {
        expect($errorsAt($this->putJson("/api/v1/properties/{$effort->id}", $without($answer, $field))->assertUnprocessable(), $field))
            ->toBe([__('field.required')], "without {$field}");
    }

    expect($errorsAt($this->putJson("/api/v1/properties/{$effort->id}", $without($answer, 'settings.decimals'))->assertUnprocessable(), 'settings.decimals'))
        ->toBe([__('field.required')])
        ->and($errorsAt($this->putJson("/api/v1/properties/{$dropdown['id']}", $without($dropdown, 'settings'))->assertUnprocessable(), 'settings.multiple'))
        ->toBe([__('field.required')])
        ->and($errorsAt($this->putJson("/api/v1/properties/{$dropdown['id']}", $without($dropdown, 'options'))->assertUnprocessable(), 'options'))
        ->toBe([__('field.required')])
        ->and(eventsOf(EventType::PropertyUpdated))->toBeEmpty();

    // help and default value are the nullable ones: missing, they are empty
    $this->putJson("/api/v1/properties/{$effort->id}", [...$without($answer, 'help'), 'default_value' => 2])->assertOk()
        ->assertJsonPath('data.help', '')->assertJsonPath('data.default_value', 2);
    $this->putJson("/api/v1/properties/{$effort->id}", $without($answer, 'default_value'))->assertOk()
        ->assertJsonPath('data.help', $answer['help'])->assertJsonPath('data.default_value', null);

    expect(eventsOf(EventType::PropertyUpdated, $effort)->map(fn ($event) => $event->changes)->all())->toBe([
        ['help' => ['old' => $answer['help'], 'new' => ''], 'default_value' => ['old' => null, 'new' => 2]],
        ['help' => ['old' => '', 'new' => $answer['help']], 'default_value' => ['old' => 2, 'new' => null]],
    ]);
});

it('checks the default value against the field type', function (string $type, bool $multiple, mixed $value, string $message) use ($errorsAt, $probe) {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/properties', $probe($type, $multiple, $value))->assertUnprocessable();

    expect($errorsAt($response, 'default_value'))->toBe([__($message)])
        ->and(Property::query()->count())->toBe(1);
})->with([
    // the cases of DefaultValueTest that JSON carries and TrimStrings leaves as they are
    'text too long' => ['text', false, str_repeat('a', 256), 'field.default_value.text'],
    'text is no string' => ['text', false, 12, 'field.default_value.text'],
    'number is text' => ['number', false, 'abc', 'field.default_value.number'],
    'number in exponent form' => ['number', false, '1e3', 'field.default_value.number'],
    'number is too long for a float' => ['number', false, str_repeat('9', 400), 'field.default_value.number'],
    'number is a boolean' => ['number', false, true, 'field.default_value.number'],
    'dropdown unknown option' => ['dropdown', false, 'opt_x', 'field.default_value.option'],
    'dropdown list for one value' => ['dropdown', false, ['opt_a'], 'field.default_value.single'],
    'dropdown multiple unknown option' => ['dropdown', true, ['opt_x'], 'field.default_value.option'],
    'dropdown multiple one unknown option' => ['dropdown', true, ['opt_a', 'opt_x'], 'field.default_value.option'],
    'dropdown option is no string' => ['dropdown', false, 1, 'field.default_value.option'],
    'boolean is text' => ['boolean', false, 'yes', 'field.default_value.boolean'],
    'boolean is a number' => ['boolean', false, 1, 'field.default_value.boolean'],
    'date not a day' => ['date', false, '2026-02-30', 'field.default_value.date'],
    'date in German form' => ['date', false, '31.10.2026', 'field.default_value.date'],
    'date is no string' => ['date', false, 20261031, 'field.default_value.date'],
    'url with another scheme' => ['url', false, 'ftp://example.com', 'field.default_value.url'],
    'url without a scheme' => ['url', false, 'example.com', 'field.default_value.url'],
    'url without a host' => ['url', false, 'https://', 'field.default_value.url'],
    'url is no string' => ['url', false, 12, 'field.default_value.url'],
    'url with a blank inside' => ['url', false, 'https://example.com/a b', 'field.default_value.url'],
    'url with a control character' => ['url', false, "https://example.com/\x07", 'field.default_value.url'],
    'member has no default' => ['member', true, ['u_1'], 'field.default_value.none'],
    'rich text has no default' => ['rich_text', false, ['type' => 'doc'], 'field.default_value.none'],
]);

it('takes a blank text, an empty choice and an archived option as what they are', function () use ($probe, $browser) {
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);

    // no default at all, not an empty one; a blank text only an action receives, REST makes it null before (P29)
    expect(SaveProperty::run(actor($admin), null, [...$probe('text', false, " \t"), 'key' => 'blank'])->default_value)->toBeNull();
    $this->postJson('/api/v1/properties', [...$probe('dropdown', true, []), 'key' => 'none_chosen'])->assertCreated()->assertJsonPath('data.default_value', null);

    // an archived option is offered no more, so it is no default either
    $archived = $browser(['default_value' => 'opt_b']);
    $archived['options'][1]['archived_at'] = '2026-10-31T08:00:00.000000Z';

    $this->postJson('/api/v1/properties', $archived)->assertUnprocessable()->assertJsonPath('errors.default_value', [__('field.default_value.option')]);

    expect(Property::query()->orderBy('id')->pluck('key')->all())->toBe(['effort', 'blank', 'none_chosen']);
});

it('refuses settings and options that the field type does not have', function (array $input, string $field, string $message) use ($errorsAt) {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/properties', ['key' => 'probe', 'label' => 'Probe', ...$input])->assertUnprocessable();

    expect($errorsAt($response, $field))->toBe([__($message)])
        ->and(Property::query()->count())->toBe(1);
})->with([
    'text with decimals' => [['field_type' => 'text', 'settings' => ['decimals' => 1]], 'settings', 'field.settings.invalid'],
    'number with multiple' => [['field_type' => 'number', 'settings' => ['decimals' => 1, 'multiple' => true]], 'settings', 'field.settings.invalid'],
    'number with five decimals' => [['field_type' => 'number', 'settings' => ['decimals' => 5]], 'settings.decimals', 'field.settings.decimals'],
    'number with a broken number of decimals' => [['field_type' => 'number', 'settings' => ['decimals' => 1.5]], 'settings.decimals', 'field.settings.decimals'],
    'member choice that is no boolean' => [['field_type' => 'member', 'settings' => ['multiple' => 'ja']], 'settings.multiple', 'field.boolean'],
    'text with options' => [['field_type' => 'text', 'options' => [['label' => 'A', 'color' => 'sky']]], 'options', 'field.options.dropdown_only'],
    'dropdown with archived options only' => [[
        'field_type' => 'dropdown', 'settings' => ['multiple' => false],
        'options' => [['label' => 'A', 'color' => 'sky', 'archived_at' => '2026-10-31T08:00:00.000000Z']],
    ], 'options', 'field.options.required'],
    'dropdown without options' => [['field_type' => 'dropdown', 'settings' => ['multiple' => false], 'options' => []], 'options', 'field.options.required'],
]);

it('checks the key, label, help text and options of a dropdown', function (Closure $change, string $field, Closure $message) use ($errorsAt, $browser) {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/api/v1/properties', $change($browser()))->assertUnprocessable();

    expect($errorsAt($response, $field))->toBe([$message()])
        ->and(Property::query()->count())->toBe(1);
})->with([
    'an unknown field type' => [fn (array $input) => [...$input, 'field_type' => 'select'], 'field_type', fn () => __('field.field_type.unknown')],
    'an empty label' => [fn (array $input) => [...$input, 'label' => ' '], 'label', fn () => __('field.label.required')],
    'a label of 61 characters' => [fn (array $input) => [...$input, 'label' => str_repeat('l', 61)], 'label', fn () => __('field.label.max', ['max' => 60])],
    'a help text of 501 characters' => [fn (array $input) => [...$input, 'help' => str_repeat('h', 501)], 'help', fn () => __('field.help.max', ['max' => 500])],
    'an option without a label' => [function (array $input) {
        $input['options'][1]['label'] = ' ';

        return $input;
    }, 'options.1.label', fn () => __('field.options.label_required')],
    'an option label of 61 characters' => [function (array $input) {
        $input['options'][1]['label'] = str_repeat('o', 61);

        return $input;
    }, 'options.1.label', fn () => __('field.options.label_max', ['max' => 60])],
    'an option of an unknown colour' => [function (array $input) {
        $input['options'][1]['color'] = 'red';

        return $input;
    }, 'options.1.color', fn () => __('field.color.unknown')],
    'two options with one id' => [function (array $input) {
        $input['options'][1]['id'] = 'opt_a';

        return $input;
    }, 'options.1.id', fn () => __('field.options.duplicate_id')],
    'an id that looks like the key of an option without one' => [function (array $input) {
        $input['options'][0]['id'] = 'new:1';
        unset($input['options'][1]['id']);

        return $input;
    }, 'options.0.id', fn () => __('field.options.id_reserved')],
    'an id of 65 characters' => [function (array $input) {
        $input['options'][1]['id'] = str_repeat('i', 65);

        return $input;
    }, 'options.1.id', fn () => __('field.options.id_invalid', ['max' => 64])],
    'an archive stamp that is no text' => [function (array $input) {
        $input['options'][1]['archived_at'] = true;

        return $input;
    }, 'options.1.archived_at', fn () => __('field.archived_at.invalid')],
    '101 options' => [fn (array $input) => [...$input, 'options' => array_map(
        fn (int $n) => ['id' => "opt_{$n}", 'label' => "Option {$n}", 'color' => 'sky'],
        range(1, 101),
    )], 'options', fn () => __('field.options.max', ['max' => 100])],
    'options that are no list' => [fn (array $input) => [...$input, 'options' => 'all'], 'options', fn () => __('field.options.required')],
]);

it('drops the options it is no longer sent and keeps the others with their ids', function () use ($browser) {
    $this->actingAs(User::factory()->admin()->create());
    $answer = $this->postJson('/api/v1/properties', $browser([
        'options' => [
            ['id' => 'opt_a', 'label' => 'Chrome', 'color' => 'sky'],
            ['id' => 'opt_b', 'label' => 'Firefox', 'color' => 'ochre'],
            ['id' => 'opt_c', 'label' => 'Safari', 'color' => 'moss'],
        ],
        'default_value' => 'opt_c',
    ]))->assertCreated()->json('data');
    [$chrome, $firefox, $safari] = array_column($answer['options'], 'id');
    $property = Property::query()->findOrFail($answer['id']);
    $this->travel(5)->minutes();

    // Safari first and renamed, Chrome behind it, Firefox gone, Edge new without an id; the default by its ULID in capitals
    $response = $this->putJson("/api/v1/properties/{$property->id}", [...$answer, 'options' => [
        ['id' => strtoupper($safari), 'label' => 'Safari (macOS)', 'color' => 'moss'],
        ['id' => $chrome, 'label' => 'Chrome', 'color' => 'sky'],
        ['label' => 'Edge', 'color' => 'slate'],
    ], 'default_value' => strtoupper($safari)])->assertOk();
    $options = $response->json('data.options');
    $edge = $options[2]['id'];

    expect(array_column($options, 'id'))->toBe([$safari, $chrome, $edge])
        ->and(array_column($options, 'label'))->toBe(['Safari (macOS)', 'Chrome', 'Edge'])
        ->and(array_column($options, 'position'))->toBe([0, 1, 2])
        ->and(Str::isUlid($edge))->toBeTrue()
        ->and($response->json('data.default_value'))->toBe($safari)
        ->and(PropertyOption::query()->whereKey($firefox)->exists())->toBeFalse()
        // only options changed, the property changed all the same
        ->and($property->fresh()?->updated_at?->gte($property->updated_at?->copy()->addMinutes(5)))->toBeTrue();

    $changes = eventsOf(EventType::PropertyUpdated, $property)->sole()->changes;

    expect(array_keys($changes))->toBe(['options'])
        ->and($changes['options']['old'])->toBe([
            ['id' => $chrome, 'label' => 'Chrome', 'color' => 'sky', 'archived' => false],
            ['id' => $firefox, 'label' => 'Firefox', 'color' => 'ochre', 'archived' => false],
            ['id' => $safari, 'label' => 'Safari', 'color' => 'moss', 'archived' => false],
        ])
        ->and($changes['options']['new'])->toBe([
            ['id' => $safari, 'label' => 'Safari (macOS)', 'color' => 'moss', 'archived' => false],
            ['id' => $chrome, 'label' => 'Chrome', 'color' => 'sky', 'archived' => false],
            ['id' => $edge, 'label' => 'Edge', 'color' => 'slate', 'archived' => false],
        ]);
});

it('takes an option id of another property as a new option', function () use ($browser) {
    $this->actingAs(User::factory()->admin()->create());
    $other = Property::factory()->dropdown(['Hoch'])->create();
    $foreign = $other->options()->sole()->id;

    $response = $this->postJson('/api/v1/properties', $browser([
        'options' => [['id' => $foreign, 'label' => 'Chrome', 'color' => 'sky']],
        'default_value' => $foreign,
    ]))->assertCreated();
    $chrome = $response->json('data.options.0.id');

    expect($chrome)->not->toBe($foreign)
        ->and($response->json('data.default_value'))->toBe($chrome)
        ->and($other->options()->sole()->label)->toBe('Hoch');
});

it('deletes a property and takes it off the types', function () {
    $effort = Property::query()->where('key', 'effort')->sole();
    $bug = WorkItemType::query()->where('name', 'Bug')->sole();

    $this->actingAs(User::factory()->admin()->create())->deleteJson("/api/v1/properties/{$effort->id}")
        ->assertOk()->assertExactJson(['affected_items' => 0]);

    $event = eventsOf(EventType::PropertyDeleted, $effort)->sole();

    expect(Property::query()->whereKey($effort->id)->exists())->toBeFalse()
        ->and(TypeProperty::query()->where('type_id', $bug->id)->exists())->toBeFalse()
        ->and($event->meta['key'])->toBe('effort')
        ->and($event->meta['label'])->toBe($effort->label)
        ->and($event->meta['types'])->toBe(['Bug'])
        ->and(eventsOf(EventType::WorkItemTypeUpdated))->toBeEmpty();
});

it('records nothing when nothing changes', function () use ($browser) {
    $this->actingAs(User::factory()->admin()->create());
    $input = $browser(['settings' => ['multiple' => true], 'default_value' => ['opt_a']]);
    $input['options'][1]['archived_at'] = '2000-01-01';
    $answer = $this->postJson('/api/v1/properties', $input)->assertCreated()->json('data');
    $property = Property::query()->findOrFail($answer['id']);
    $this->travel(5)->minutes();

    $this->putJson("/api/v1/properties/{$property->id}", $answer)->assertOk()->assertJsonPath('data', $answer);

    expect(eventsOf(EventType::PropertyUpdated))->toBeEmpty()
        ->and($answer['options'][1]['archived_at'])->not->toBeNull()
        ->and($property->fresh()?->updated_at?->toJSON())->toBe($property->updated_at?->toJSON())
        // a write now would stamp the time five minutes on
        ->and(PropertyOption::query()->where('property_id', $property->id)->where('updated_at', '>', now()->subMinute())->exists())->toBeFalse();
});

it('answers 404 for a property deleted meanwhile', function () use ($problemOf, $browser) {
    $admin = User::factory()->admin()->create();
    $property = SaveProperty::run(actor($admin), null, $browser());
    $input = [...$browser(), 'label' => 'Browser (neu)'];
    $property->delete();

    expect($problemOf(fn () => SaveProperty::run(actor($admin), $property, $input))->status)->toBe(404)
        ->and($problemOf(fn () => DeleteProperty::run(actor($admin), $property))->status)->toBe(404)
        ->and(PropertyOption::query()->where('property_id', $property->id)->exists())->toBeFalse()
        ->and(eventsOf(EventType::PropertyUpdated))->toBeEmpty()
        ->and(eventsOf(EventType::PropertyDeleted))->toBeEmpty();
});

it('answers an unknown property with 404 and no detail', function () use ($browser) {
    $this->actingAs(User::factory()->admin()->create());
    $id = (string) Str::ulid();

    $this->putJson("/api/v1/properties/{$id}", $browser())->assertNotFound()->assertJsonMissingPath('detail');
    $this->deleteJson("/api/v1/properties/{$id}")->assertNotFound()->assertJsonMissingPath('detail');
});

it('lets members read the properties and refuses changes with the sentence of the catalog', function () use ($browser) {
    $effort = Property::query()->where('key', 'effort')->sole();
    $denied = __('problem.detail.properties_admins_only');

    $this->actingAs(User::factory()->create());

    $this->getJson('/api/v1/properties')->assertOk()->assertJsonPath('meta.total', 1);
    $this->postJson('/api/v1/properties', $browser())->assertForbidden()->assertJsonPath('detail', $denied);
    $this->putJson("/api/v1/properties/{$effort->id}", ['label' => 'Neu'])->assertForbidden()->assertJsonPath('detail', $denied);
    $this->deleteJson("/api/v1/properties/{$effort->id}")->assertForbidden()->assertJsonPath('detail', $denied);

    expect(Property::query()->count())->toBe(1);
});
