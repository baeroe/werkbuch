<?php

namespace App\Support;

use App\Domain\Catalog\Tone;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * What the entries of every catalog share (workflows, types, properties, labels, relation types, resolutions): a name
 * unique over the collation of the database (case and accents do not count), an optional description or help text, a
 * tone, the archive stamp, and the rule that saving replaces an entry as a whole (P24): a required field that is missing
 * is refused at that field.
 */
final class CatalogInput
{
    public const NAME_MAX = 60;

    public const DESCRIPTION_MAX = 2000;

    public const HELP_MAX = 500;

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
     * One of the six paper colours (types, options, labels, relation types).
     *
     * @return list<mixed>
     */
    public static function tone(): array
    {
        return ['required', Rule::enum(Tone::class)];
    }

    /**
     * The archive stamp as a client sends it: missing or `null` is active, a string is archived (P24, P25). The stamp
     * itself comes from `archivedStamp()`, never from the client.
     *
     * @return list<mixed>
     */
    public static function archivedAt(): array
    {
        return ['nullable', 'string'];
    }

    /**
     * The input with a blank archive stamp (`''`, only blanks) taken as none: active, not archived. REST makes it `null`
     * before (ConvertEmptyStringsToNull); an action called directly gets it as it was sent.
     *
     * @param  array<array-key, mixed>  $input
     * @return array<array-key, mixed>
     */
    public static function blankArchive(array $input): array
    {
        if (is_string($input['archived_at'] ?? null) && trim($input['archived_at']) === '') {
            $input['archived_at'] = null;
        }

        return $input;
    }

    /**
     * The archive stamp to store (P25): `$sent` is what the client sent in `archived_at` (a string: archived; `null`:
     * active), or `false`/`true` for the same. An entry that already is archived keeps its stamp, only a newly archived
     * one gets the time of now; so a `PUT` with the answer of the server changes nothing.
     */
    public static function archivedStamp(?Carbon $current, mixed $sent): ?Carbon
    {
        if ($sent === null || $sent === false) {
            return null;
        }

        return $current ?? now();
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
            'label.required' => __('field.label.required'),
            'label.string' => __('field.label.invalid'),
            'label.max' => __('field.label.max'),
            'label.unique' => __('field.label.taken'),
            'help.string' => __('field.help.invalid'),
            'help.max' => __('field.help.max'),
            'tone.enum' => __('field.tone.unknown'),
            'color.enum' => __('field.color.unknown'),
            'archived_at.string' => __('field.archived_at.invalid'),
        ];
    }
}
