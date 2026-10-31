<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\Rule;

/**
 * What the entries of every catalog share (workflows, types, properties, labels, relation types, resolutions): a name
 * unique over the collation of the database (case and accents do not count), an optional description, and the rule
 * that saving replaces an entry as a whole (P24): a required field that is missing is refused at that field.
 */
final class CatalogInput
{
    public const NAME_MAX = 60;

    public const DESCRIPTION_MAX = 2000;

    /**
     * The input with the named texts trimmed; anything that is no text stays as it came for the rules to refuse.
     *
     * @param  array<array-key, mixed>  $input
     * @param  list<string>  $fields
     * @return array<array-key, mixed>
     */
    public static function trim(array $input, array $fields): array
    {
        foreach ($fields as $field) {
            if (is_string($input[$field] ?? null)) {
                $input[$field] = trim($input[$field]);
            }
        }

        return $input;
    }

    /**
     * A name no other entry of the table holds; `$own` keeps its own. Callers check it under `CatalogLock`, so two
     * entries with one name end as 422 at the field, never as a broken unique index.
     *
     * @return list<mixed>
     */
    public static function name(string $table, ?Model $own, string $column = 'name'): array
    {
        return ['required', 'string', 'max:'.self::NAME_MAX, Rule::unique($table, $column)->ignore($own?->getKey())];
    }

    /**
     * An optional description; missing or `null`, it is stored as `''`.
     *
     * @return list<mixed>
     */
    public static function description(): array
    {
        return ['nullable', 'string', 'max:'.self::DESCRIPTION_MAX];
    }

    /**
     * One message for every required field that is missing (`required`, or `present` where an empty list is fine).
     *
     * @param  list<string>  $fields
     * @return array<string, string>
     */
    public static function required(array $fields): array
    {
        $messages = [];

        foreach ($fields as $field) {
            $messages["{$field}.required"] = __('field.required');
            $messages["{$field}.present"] = __('field.required');
        }

        return $messages;
    }

    /**
     * @return array<string, string>
     */
    public static function messages(): array
    {
        return [
            'name.required' => __('field.name.required'),
            'name.string' => __('field.name.invalid'),
            'name.max' => __('field.name.max'),
            'name.unique' => __('field.name.taken'),
            'description.string' => __('field.description.invalid'),
            'description.max' => __('field.description.max'),
        ];
    }
}
