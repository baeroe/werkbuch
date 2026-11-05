<?php

namespace App\Support;

use App\Domain\Filter\InvalidInput;
use App\Domain\Schedule\Placeholders;
use App\Domain\Schedule\Recurrence;
use App\Domain\Schedule\Schedule;
use App\Domain\WorkItems\Hierarchy;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\Template;
use App\Models\TypeProperty;
use App\Models\User;
use App\Models\WorkItemType;
use App\RichText\Document;
use App\RichText\RichTextInput;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The input of a template (spec 4.12, A75, A349): `name`, `payload` and `schedule`, all three required both when
 * creating and when replacing (`schedule` may be `null`). Other keys (the `id`, the counters and stamps of an answer sent
 * back, `payload.values_markdown`) are passed over, so `PUT` with the own answer (the description in one form, K5)
 * changes nothing. The payload is checked like the fields of a new item (ItemInput::fields(), ItemValues) without
 * required values; its title also with the longest filling of its placeholders; the dates are offsets of 0–3650 days.
 * Every field error comes in one 422, the fields of the payload below `payload.`, the schedule below `schedule.`.
 *
 * Callers read the rich text with documents() before their locks and check the rest with validate() under them.
 */
final class TemplateInput
{
    public const NAME_MAX = 120;

    public const OFFSET_MAX = 3650;

    private const REQUIRED = ['name', 'payload', 'schedule'];

    /**
     * The input with the rich text of its payload read, before any lock: `payload.description` (Markdown) or
     * `payload.description_json` becomes a Document or `null` under `payload.description`, the rich text values become
     * Documents (ItemValues::documents()), both through the rules of saving against the text of `$current` as it is
     * now. What cannot be read comes back as field errors, for validate() to report with all the others; the third part
     * names the texts by the key that sent them (`payload.description_json`, `payload.values.notes`), for
     * AttachmentLinks.
     *
     * @param  array<array-key, mixed>  $input
     * @return array{0: array<array-key, mixed>, 1: array<string, list<string>>, 2: array<string, Document>}
     */
    public static function documents(array $input, Project $project, User $writer, ?Template $current): array
    {
        $payload = $input['payload'] ?? null;
        if (! self::isMap($payload)) {
            return [$input, [], []];
        }

        $errors = [];
        $texts = [];
        $stored = $current === null ? [] : $current->payload;

        $description = null;
        if (RichTextInput::given($payload, 'description')) {
            $before = is_array($stored['description'] ?? null) ? Document::fromJson($stored['description']) : null;
            $key = array_key_exists('description', $payload) ? 'description' : 'description_json';
            try {
                $description = RichTextInput::from($payload, 'description', RichTextRules::context($project, $writer, $before));
            } catch (ValidationException $invalid) {
                $errors = self::below('payload', $invalid->errors());
            }
            if ($description !== null) {
                $texts["payload.{$key}"] = $description;
            }
        }
        unset($payload['description_json']);
        $payload['description'] = $description;

        if (is_array($payload['values'] ?? null)) {
            $before = [];
            foreach ((array) ($stored['values'] ?? []) as $key => $value) {
                if (self::isDoc($value)) {
                    $before[(string) $key] = Document::fromJson($value);
                }
            }
            [$payload['values'], $refused] = ItemValues::documents($payload['values'], $project, $writer, $before);
            $errors = [...$errors, ...self::below('payload', $refused)];
            foreach ($payload['values'] as $key => $value) {
                if ($value instanceof Document) {
                    $texts["payload.values.{$key}"] = $value;
                }
            }
        }

        $input['payload'] = $payload;

        return [$input, $errors, $texts];
    }

    /**
     * The template as it is to be stored, checked under the locks of the caller: the name (trimmed, 1–120 characters),
     * the payload in its normal form (`type_id`, `title`, `description` as Tiptap JSON or null, `priority`,
     * `assignee_id`, `label_ids`, `values` by key, `parent_id`, `start_offset_days`, `due_offset_days`) and the schedule
     * (Schedule::parse, and one without a single term is `field.schedule.never_runs`). `$current` is the template as
     * locked: the archived type it has may stay. `$zone` and `$locale` are those of the organisation (K3): the zone the
     * terms count in, the language of the month names a title may name.
     *
     * @param  array<array-key, mixed>  $input  as documents() answers it
     * @param  array<string, list<string>>  $refused  the field errors of documents()
     * @param  array<string, Document>  $texts  the third part of documents()
     * @return array{name: string, payload: array<string, mixed>, documents: array<string, Document>, schedule: ?Schedule}
     *
     * @throws ValidationException
     */
    public static function validate(array $input, Project $project, User $writer, ?Template $current, DateTimeZone $zone, string $locale, array $refused = [], array $texts = []): array
    {
        $errors = [];
        $fail = function (string $field, string $message) use (&$errors): void {
            $errors[$field] ??= [$message];
        };

        foreach (self::REQUIRED as $field) {
            if (! array_key_exists($field, $input)) {
                $fail($field, __('field.required'));
            }
        }

        $name = $input['name'] ?? null;
        $name = is_string($name) ? Str::trim($name) : $name;
        if (array_key_exists('name', $input)) {
            match (true) {
                $name === null || $name === '' => $fail('name', __('field.name.required')),
                ! is_string($name) => $fail('name', __('field.name.invalid')),
                mb_strlen($name) > self::NAME_MAX => $fail('name', __('field.name.max', ['max' => self::NAME_MAX])),
                default => null,
            };
        }

        // what documents() refused stays the error of its key (the value it left is empty)
        foreach ($refused as $field => $messages) {
            $errors[$field] ??= $messages;
        }

        $payload = null;
        if (array_key_exists('payload', $input)) {
            if (self::isMap($input['payload'])) {
                $payload = self::payload($input['payload'], $project, $writer, $current, $locale, $fail, $errors);
            } else {
                $fail('payload', __('field.payload.invalid'));
            }
        }

        $schedule = null;
        if (($input['schedule'] ?? null) !== null) {
            $schedule = self::schedule($input['schedule'], $zone, $fail);
        }

        if ($errors !== [] || ! is_string($name) || $payload === null) {
            throw ValidationException::withMessages($errors);
        }

        return ['name' => $name, 'payload' => $payload, 'documents' => $texts, 'schedule' => $schedule];
    }

    /**
     * The payload in its normal form, or null when a field of it is wrong (the errors are at `payload.<field>`).
     *
     * @param  array<array-key, mixed>  $payload
     * @param  callable(string, string): void  $fail
     * @param  array<string, list<string>>  $errors
     * @return ?array<string, mixed>
     */
    private static function payload(array $payload, Project $project, User $writer, ?Template $current, string $locale, callable $fail, array &$errors): ?array
    {
        $at = fn (string $field, string $message) => $fail("payload.{$field}", $message);
        // what the template already has stays valid (A356): its archived type, its assignee, the archived options and
        // people of its values; labels and values it has that are gone meanwhile fall away (A340)
        $stored = $current === null ? [] : $current->payload;
        $keepType = is_string($stored['type_id'] ?? null) ? $stored['type_id'] : null;
        $keepAssignee = is_string($stored['assignee_id'] ?? null) ? $stored['assignee_id'] : null;
        $storedValues = (array) ($stored['values'] ?? []);
        $payload['label_ids'] = self::withoutGoneLabels($payload['label_ids'] ?? null, (array) ($stored['label_ids'] ?? []));

        $fields = ItemInput::fields($payload, $project, $writer, $at, $keepType, $keepAssignee);
        $type = $fields['type'];
        $parent = $fields['parent'];

        if (! isset($errors['payload.title']) && Placeholders::longest($fields['title'], TemplateSchedule::monthNames($locale)) > ItemInput::TITLE_MAX) {
            $at('title', __('field.title.max', ['max' => ItemInput::TITLE_MAX]));
        }

        if ($type !== null && $parent !== null) {
            $refusal = match (true) {
                ! Hierarchy::canHaveParent($type->is_epic) => 'epic_has_no_parent',
                ! Hierarchy::canHaveChildren($parent->type->is_epic) => 'parent_not_epic',
                default => null,
            };
            if ($refusal !== null) {
                $at('parent_id', __("problem.reason.{$refusal}"));
            }
        }

        $values = [];
        if ($type !== null) {
            try {
                // no required values (A349): the editor marks them, a run fails without them
                $sent = self::withoutGoneKeys(ItemInput::values($payload['values'] ?? [], $at), $storedValues, $type);
                $values = ItemValues::check($project, $type, $sent, [], 'update', $storedValues);
                ksort($values);
            } catch (ValidationException $invalid) {
                foreach (self::below('payload', $invalid->errors()) as $field => $messages) {
                    $errors[$field] ??= $messages;
                }
            }
        }

        $start = self::offset($payload, 'start_offset_days', $at);
        $due = self::offset($payload, 'due_offset_days', $at);
        if ($start !== null && $due !== null && $due < $start) {
            $at('due_offset_days', __('field.due_offset.before_start'));
        }

        if ($type === null) {
            return null;
        }

        $description = $payload['description'] ?? null;

        return [
            'type_id' => $type->id,
            'title' => $fields['title'],
            'description' => $description instanceof Document ? $description->toJson() : null,
            'priority' => $fields['priority']->value,
            'assignee_id' => $fields['assignee_id'],
            'label_ids' => $fields['label_ids'],
            'values' => $values,
            'parent_id' => $parent?->id,
            'start_offset_days' => $start,
            'due_offset_days' => $due,
        ];
    }

    /**
     * The label ids sent without those the template has and that are gone meanwhile (A356, like a run, A340); an
     * unknown label the template never had stays for ItemInput::fields() to refuse.
     *
     * @param  array<array-key, mixed>  $stored  the label ids the template has
     */
    private static function withoutGoneLabels(mixed $ids, array $stored): mixed
    {
        if (! is_array($ids) || ! array_is_list($ids)) {
            return $ids;
        }

        $had = array_values(array_intersect(array_map(strtolower(...), array_filter($ids, is_string(...))), $stored));
        if ($had === []) {
            return $ids;
        }

        $gone = array_diff($had, Label::query()->whereKey($had)->pluck('id')->all());

        return array_values(array_filter($ids, fn (mixed $id) => ! is_string($id) || ! in_array(strtolower($id), $gone, true)));
    }

    /**
     * The values sent without those of keys the template has a value of and that the type has no (longer): the property
     * was deleted or taken from the type (A356, like a run, A340). A key the template never had stays for
     * ItemValues::check() to refuse.
     *
     * @param  array<array-key, mixed>  $sent
     * @param  array<array-key, mixed>  $stored  the values the template has
     * @return array<array-key, mixed>
     */
    private static function withoutGoneKeys(array $sent, array $stored, WorkItemType $type): array
    {
        $had = array_intersect_key($sent, $stored);
        if ($had === []) {
            return $sent;
        }

        $known = Property::query()->whereIn('id', TypeProperty::query()->where('type_id', $type->id)->select('property_id'))->pluck('key')->all();

        return array_diff_key($sent, array_diff_key($had, array_flip($known)));
    }

    /**
     * @param  array<array-key, mixed>  $payload
     * @param  callable(string, string): void  $at
     */
    private static function offset(array $payload, string $field, callable $at): ?int
    {
        $days = $payload[$field] ?? null;
        if ($days === null) {
            return null;
        }
        if (! is_int($days) || $days < 0 || $days > self::OFFSET_MAX) {
            $at($field, __('field.offset.invalid', ['max' => self::OFFSET_MAX]));

            return null;
        }

        return $days;
    }

    /**
     * The schedule, or null when it cannot be read: each code at the field it names (`schedule` for the whole), and one
     * that has no single term (not even when it were not paused) is `field.schedule.never_runs`.
     *
     * @param  callable(string, string): void  $fail
     */
    private static function schedule(mixed $raw, DateTimeZone $zone, callable $fail): ?Schedule
    {
        try {
            $schedule = Schedule::parse($raw);
        } catch (InvalidInput $invalid) {
            foreach ($invalid->errorsAt('schedule') as $path => $code) {
                $fail($path, self::scheduleMessage($path, $code));
            }

            return null;
        }

        $running = new Schedule($schedule->frequency, $schedule->interval, $schedule->weekdays, $schedule->monthDay, $schedule->nthWeekday,
            $schedule->yearlyDate, $schedule->time, $schedule->startsOn, $schedule->ends, false);
        $before = (new DateTimeImmutable($schedule->startsOn, $zone))->modify('-1 day');
        if (Recurrence::next($running, $before, 1, $zone) === []) {
            $fail('schedule', __('field.schedule.never_runs'));

            return null;
        }

        return $schedule;
    }

    /** The field message of a code of Schedule::parse() at its path below `schedule` (PreviewSchedule as well). */
    public static function scheduleMessage(string $path, string $code): string
    {
        return match (true) {
            $path === 'schedule.paused' => __('field.boolean'),
            $code === 'frequency' => __('field.schedule.frequency'),
            $code === 'interval' => __('field.schedule.interval', ['max' => Schedule::MAX_INTERVAL]),
            $code === 'weekdays' => __('field.schedule.weekdays'),
            $code === 'month_day' => __('field.schedule.month_day'),
            $code === 'nth_weekday' => __('field.schedule.nth_weekday'),
            $code === 'yearly_date' => __('field.schedule.yearly_date'),
            $code === 'time' => __('field.schedule.time'),
            $code === 'starts_on' => __('field.schedule.starts_on'),
            $code === 'ends' => __('field.schedule.ends', ['max' => Schedule::MAX_COUNT]),
            $code === 'range' => __('field.schedule.range', ['first' => Schedule::FIRST_DAY, 'last' => Schedule::LAST_DAY]),
            default => __('field.schedule.shape'),
        };
    }

    /**
     * Field errors at the paths below `$prefix`.
     *
     * @param  array<string, list<string>>  $errors
     * @return array<string, list<string>>
     */
    private static function below(string $prefix, array $errors): array
    {
        $below = [];
        foreach ($errors as $field => $messages) {
            $below["{$prefix}.{$field}"] = $messages;
        }

        return $below;
    }

    /** An object of JSON: an array that is no list (an empty one counts as an empty object). */
    private static function isMap(mixed $value): bool
    {
        return is_array($value) && ($value === [] || ! array_is_list($value));
    }

    /** A stored rich text value: Tiptap JSON of a document. */
    public static function isDoc(mixed $value): bool
    {
        return is_array($value) && ($value['type'] ?? null) === 'doc';
    }
}
