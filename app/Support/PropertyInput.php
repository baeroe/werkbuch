<?php

namespace App\Support;

use App\Domain\Catalog\Tone;
use App\Domain\Properties\DefaultValue;
use App\Domain\Properties\FieldType;
use App\Domain\Properties\PropertyKey;
use App\Models\Property;
use Closure;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The rules, field messages (P9) and the shape of a property as a client sends it (spec 4.7, `saveProperty` of the
 * clickdummy): key, label, field type, help text, the settings of the field type, the options of a dropdown and the
 * default value. Key and field type are fixed once saved (only a single choice may become a multiple one). New options
 * come with ids of the client (P3); only the options of the property itself keep their ULID, any other id is a new
 * option. Writes nothing.
 */
final class PropertyInput
{
    public const LABEL_MAX = CatalogInput::NAME_MAX;

    public const OPTIONS_MAX = 100;

    public const OPTION_LABEL_MAX = 60;

    /** The longest id a client may give an option. */
    public const KEY_MAX = 64;

    /** The start of the key of an option sent without an id (`new:<index>`); sent ids never start with it. */
    public const NEW_KEY = 'new:';

    /** The most decimals a number keeps. */
    public const DECIMALS_MAX = 4;

    /**
     * The input with its texts trimmed and every ULID in lower case (local ids stay as they came). The key stays as it
     * came: a key with blanks is malformed, not a key to repair.
     *
     * @param  array<array-key, mixed>  $input
     * @return array<array-key, mixed>
     */
    public static function normalize(array $input): array
    {
        $input = CatalogInput::trim($input, ['label', 'help']);

        if (is_array($input['options'] ?? null)) {
            foreach ($input['options'] as $index => $option) {
                if (is_array($option)) {
                    $input['options'][$index] = CatalogInput::trim($option, ['label']);

                    if (array_key_exists('id', $option)) {
                        $input['options'][$index]['id'] = Ids::normalize($option['id']);
                    }
                }
            }
        }

        if (array_key_exists('default_value', $input)) {
            $input['default_value'] = Ids::normalize($input['default_value']);
        }

        return $input;
    }

    /**
     * The property as it is to be saved. Every option gets a `key`: the id it was sent with, `new:<index>` without one;
     * `existing` is that id when it is an option of `$existing`, else `null` (a new row). A default value of a dropdown
     * names the keys of options that are not archived.
     *
     * @param  array<array-key, mixed>  $input
     * @return array{key: string, label: string, field_type: FieldType, help: string, settings: array{multiple?: bool, decimals?: int}, options: list<array{key: string, existing: ?string, label: string, color: Tone, archived: bool}>, default_value: mixed}
     *
     * @throws ValidationException
     */
    public static function validate(array $input, ?Property $existing): array
    {
        /** @var array{key: string, label: string, field_type: string, help?: ?string} $valid */
        $valid = Validator::make($input, [
            'key' => $existing === null
                ? ['bail', 'required', 'string', self::newKey(), Rule::unique('properties', 'key')]
                : ['bail', 'required', self::same($existing->key, 'field.key.immutable')],
            'field_type' => $existing === null
                ? ['required', Rule::enum(FieldType::class)]
                : ['bail', 'required', self::same($existing->field_type->value, 'field.field_type.immutable')],
            'label' => ['bail', 'present', 'required', 'string', 'max:'.self::LABEL_MAX],
            'help' => ['nullable', 'string', 'max:'.CatalogInput::HELP_MAX],
        ], self::messages())->validate();

        $type = FieldType::from($valid['field_type']);

        /** @var array{settings?: ?array{decimals?: int|string, multiple?: bool|int|string}, options?: ?array<array-key, array{id?: ?string, label: string, color: string, archived_at?: ?string}>} $typed */
        $typed = Validator::make($input, self::typeRules($type), self::typeMessages($type))->validate();

        $settings = [];

        if ($type->hasDecimals()) {
            $settings['decimals'] = (int) ($typed['settings']['decimals'] ?? 0);
        }

        if ($type->allowsMultiple()) {
            $settings['multiple'] = (bool) ($typed['settings']['multiple'] ?? false);

            // a single choice may become a multiple one, never back: items would lose all their values but one
            if (($existing?->settings['multiple'] ?? false) === true && ! $settings['multiple']) {
                throw ValidationException::withMessages(['settings.multiple' => __('field.settings.multiple_back')]);
            }
        }

        $options = self::options($input, $typed['options'] ?? [], $existing);

        if ($type->hasOptions() && array_filter($options, fn (array $option) => ! $option['archived']) === []) {
            throw ValidationException::withMessages(['options' => __('field.options.required')]);
        }

        $default = DefaultValue::normalize(
            $type,
            $settings['decimals'] ?? 0,
            $settings['multiple'] ?? false,
            array_column(array_filter($options, fn (array $option) => ! $option['archived']), 'key'),
            $input['default_value'] ?? null,
        );

        if (! $default->ok()) {
            throw ValidationException::withMessages(['default_value' => self::defaultValueMessage((string) $default->error)]);
        }

        return [
            'key' => $valid['key'],
            'label' => $valid['label'],
            'field_type' => $type,
            'help' => $valid['help'] ?? '',
            'settings' => $settings,
            'options' => $options,
            'default_value' => $default->value,
        ];
    }

    /**
     * The options in the order they were sent (`validated()` puts an option without an id behind those with one).
     *
     * @param  array<array-key, mixed>  $input
     * @param  array<array-key, array{id?: ?string, label: string, color: string, archived_at?: ?string}>  $valid
     * @return list<array{key: string, existing: ?string, label: string, color: Tone, archived: bool}>
     *
     * @throws ValidationException
     */
    private static function options(array $input, array $valid, ?Property $existing): array
    {
        if ($valid === []) {
            return [];
        }

        /** @var array<array-key, mixed> $sent */
        $sent = $input['options'];
        $own = $existing?->options->modelKeys() ?? [];
        $options = [];
        $keys = [];
        $position = 0;

        foreach (array_keys($sent) as $index) {
            $option = $valid[$index];
            $key = $option['id'] ?? self::NEW_KEY.$position;

            // a sent id names one option only
            if (isset($keys[$key])) {
                throw ValidationException::withMessages(["options.{$index}.id" => __('field.options.duplicate_id')]);
            }

            $keys[$key] = true;
            $options[] = [
                'key' => $key,
                'existing' => in_array($key, $own, true) ? $key : null,
                'label' => $option['label'],
                'color' => Tone::from($option['color']),
                'archived' => ($option['archived_at'] ?? null) !== null,
            ];
            $position++;
        }

        return $options;
    }

    /**
     * A key of a new property: snake_case of at most 40 characters, and no core field of an item.
     */
    private static function newKey(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            if (! PropertyKey::isValid((string) $value)) {
                $fail(__('field.key.format'));
            } elseif (PropertyKey::isCore((string) $value)) {
                $fail(__('field.key.core'));
            }
        };
    }

    /**
     * A value that has to stay what is stored.
     */
    private static function same(string $stored, string $message): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($stored, $message): void {
            if ($value !== $stored) {
                $fail(__($message));
            }
        };
    }

    /**
     * The settings and options a field type has (P24): a number needs its decimals, a dropdown and a choice of people
     * whether they take several values, a dropdown its options; every other one has none of them (missing or empty).
     *
     * @return array<string, mixed>
     */
    private static function typeRules(FieldType $type): array
    {
        $rules = [
            'settings' => match (true) {
                $type->hasDecimals() => ['nullable', 'array:decimals'],
                $type->allowsMultiple() => ['nullable', 'array:multiple'],
                default => ['nullable', 'array', 'max:0'],
            },
        ];

        if ($type->hasDecimals()) {
            $rules['settings.decimals'] = ['required', 'integer', 'between:0,'.self::DECIMALS_MAX];
        }

        if ($type->allowsMultiple()) {
            $rules['settings.multiple'] = ['required', 'boolean'];
        }

        if (! $type->hasOptions()) {
            return [...$rules, 'options' => ['nullable', 'array', 'max:0']];
        }

        return [
            ...$rules,
            'options' => ['present', 'array', 'max:'.self::OPTIONS_MAX],
            'options.*' => ['array'],
            // `new:<index>` names an option sent without an id; no id of the client looks like one
            'options.*.id' => ['nullable', 'string', 'max:'.self::KEY_MAX, 'doesnt_start_with:'.self::NEW_KEY],
            'options.*.label' => ['required', 'string', 'max:'.self::OPTION_LABEL_MAX],
            'options.*.color' => CatalogInput::tone(),
            'options.*.archived_at' => CatalogInput::archivedAt(),
        ];
    }

    /**
     * @return array<string, string>
     */
    private static function typeMessages(FieldType $type): array
    {
        $settings = [
            'settings.array' => __('field.settings.invalid'),
            'settings.max' => __('field.settings.invalid'),
            'settings.decimals.required' => __('field.required'),
            'settings.decimals.integer' => __('field.settings.decimals'),
            'settings.decimals.between' => __('field.settings.decimals'),
            'settings.multiple.required' => __('field.required'),
            'settings.multiple.boolean' => __('field.boolean'),
        ];

        if (! $type->hasOptions()) {
            return [
                ...$settings,
                'options.array' => __('field.options.dropdown_only'),
                'options.max' => __('field.options.dropdown_only'),
            ];
        }

        return [
            ...$settings,
            'options.present' => __('field.required'),
            'options.array' => __('field.options.required'),
            'options.max' => __('field.options.max'),
            'options.*.array' => __('field.options.label_required'),
            // the string rule fills no :max, so the sentence comes filled
            'options.*.id.string' => __('field.options.id_invalid', ['max' => self::KEY_MAX]),
            'options.*.id.max' => __('field.options.id_invalid', ['max' => self::KEY_MAX]),
            'options.*.id.doesnt_start_with' => __('field.options.id_reserved'),
            'options.*.label.required' => __('field.options.label_required'),
            'options.*.label.string' => __('field.options.label_required'),
            'options.*.label.max' => __('field.options.label_max'),
            'options.*.color.required' => __('field.color.unknown'),
            'options.*.color.enum' => __('field.color.unknown'),
            'options.*.archived_at.string' => __('field.archived_at.invalid'),
        ];
    }

    /**
     * The sentence for what is wrong with a default value (a fixed table, so the scan of used keys finds them).
     */
    private static function defaultValueMessage(string $error): string
    {
        return match ($error) {
            'text' => __('field.default_value.text'),
            'number' => __('field.default_value.number'),
            'option' => __('field.default_value.option'),
            'single' => __('field.default_value.single'),
            'boolean' => __('field.default_value.boolean'),
            'date' => __('field.default_value.date'),
            'url' => __('field.default_value.url'),
            default => __('field.default_value.none'),
        };
    }

    /**
     * @return array<string, string>
     */
    private static function messages(): array
    {
        return [
            ...CatalogInput::messages(),
            ...CatalogInput::required(['key', 'field_type']),
            'label.present' => __('field.required'),
            'key.string' => __('field.key.format'),
            'key.unique' => __('field.key.taken'),
            'field_type.enum' => __('field.field_type.unknown'),
        ];
    }
}
