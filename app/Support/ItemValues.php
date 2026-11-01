<?php

namespace App\Support;

use App\Access\Assignable;
use App\Domain\Properties\FieldType;
use App\Domain\Properties\ItemValue;
use App\Domain\Properties\PropertyShape;
use App\Models\Project;
use App\Models\Property;
use App\Models\PropertyOption;
use App\Models\TypeProperty;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Models\WorkItemValue;
use App\RichText\Document;
use App\RichText\InvalidDocument;
use App\RichText\MarkdownContext;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * The values of the custom properties of a work item (spec 4.7; `checkValues` of `values.ts`): checked against the
 * properties of its type, stored one row per value (P9) and read back as a map of property key → value. Field errors
 * name `values.<key>` and the label of the property.
 */
final class ItemValues
{
    /**
     * The rich text values of a `values` map read into documents, before the caller takes any lock (reading Markdown
     * is the expensive, size-limited step). Only the keys of rich text properties change: a document, or `null` for an
     * empty one or one that is refused at `values.<key>`.
     *
     * @param  array<array-key, mixed>  $values
     * @return array{0: array<array-key, mixed>, 1: array<string, list<string>>}
     */
    public static function documents(array $values, MarkdownContext $ctx): array
    {
        $keys = array_values(array_filter(array_keys($values), is_string(...)));
        $properties = Property::query()->whereIn('key', $keys)->where('field_type', FieldType::RichText)->get();
        $errors = [];

        foreach ($properties as $property) {
            $document = self::document($property, $values[$property->key], $ctx);
            if (is_string($document)) {
                $errors["values.{$property->key}"] = [$document];
            }
            // a refused value is read no second time under the lock; its error stands for it
            $values[$property->key] = is_string($document) ? null : $document;
        }

        return [$values, $errors];
    }

    /**
     * The values to store: `$existing` with what `$input` sends merged in, each checked against the properties of the
     * type. An empty value removes a property, unless it is required: when creating always, when updating only when it
     * had a value (a property that became required later stays empty until somebody fills it). When creating (a new
     * item, or a new type for an item with `$existing` the values it keeps), a property that neither the input nor
     * `$existing` names takes its default value, and every required property must have a value. People
     * picked anew must be able to take work in the project (`Assignable`); people the item has already only need to
     * exist. ULIDs are written in lower case for dropdowns and people only, never in texts (K19).
     *
     * @param  array<array-key, mixed>  $input  property key → value (rich text as a Document from documents(), or as Markdown or JSON)
     * @param  array<string, mixed>  $existing  the values the item has (of())
     * @param  'create'|'update'  $mode
     * @return array<string, mixed>
     *
     * @throws ValidationException at `values.<key>`
     */
    public static function check(Project $project, WorkItemType $type, array $input, array $existing, string $mode): array
    {
        /** @var Collection<string, TypeProperty> $entries */
        $entries = $type->typeProperties()->with('property.options')->get()->keyBy(fn (TypeProperty $entry) => $entry->property->key);
        $ctx = new MarkdownContext($project);
        $values = $existing;
        $errors = [];

        foreach ($input as $key => $raw) {
            $key = (string) $key;
            $entry = $entries->get($key);
            if ($entry === null) {
                $errors["values.{$key}"] = [__('field.values.unknown', ['key' => $key, 'type' => $type->name])];

                continue;
            }

            $property = $entry->property;
            $value = match ($property->field_type) {
                // ids of options and people in lower case; texts keep their case, even when they look like a ULID
                FieldType::Dropdown, FieldType::Member => Ids::normalize($raw),
                FieldType::RichText => self::document($property, $raw, $ctx),
                default => $raw,
            };
            if (is_string($value) && $property->field_type === FieldType::RichText) {
                $errors["values.{$key}"] = [$value];

                continue;
            }
            if ($value instanceof Document) {
                $value = $value->toJson();
            }

            if (ItemValue::isEmpty($value)) {
                if ($entry->required && ($mode === 'create' || ! ItemValue::isEmpty($existing[$key] ?? null))) {
                    $errors["values.{$key}"] = [self::requiredMessage($property)];
                } else {
                    unset($values[$key]);
                }

                continue;
            }

            $current = $existing[$key] ?? null;
            $normalized = ItemValue::normalize(self::shape($property), $value, $current);
            if (! $normalized->ok()) {
                $errors["values.{$key}"] = [self::message((string) $normalized->error, $property)];
            } elseif ($property->field_type === FieldType::Member && ! self::canPick($project, $normalized->value, $current)) {
                $errors["values.{$key}"] = [self::message('member', $property)];
            } else {
                $values[$key] = $normalized->value;
            }
        }

        if ($mode === 'create') {
            foreach ($entries as $key => $entry) {
                if (! array_key_exists($key, $input) && ! array_key_exists($key, $existing) && ($default = self::default($entry->property)) !== null) {
                    $values[$key] = $default;
                }

                if ($entry->required && ItemValue::isEmpty($values[$key] ?? null) && ! isset($errors["values.{$key}"])) {
                    $errors["values.{$key}"] = [self::requiredMessage($entry->property)];
                }
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $values;
    }

    /**
     * Writes the values of the item: only the properties whose value changed against `$before` lose their rows and get
     * new ones (a multiple choice one row per value, `position` 0, 1, …); the rows of the others stay as they are. A
     * rich text value keeps its plain text beside the document (`value_text`, which the filter searches).
     *
     * @param  array<string, mixed>  $values  property key → value, as check() answers
     * @param  array<string, mixed>  $before  the values before the change (of())
     */
    public static function store(WorkItem $item, array $values, array $before): void
    {
        $changed = array_values(array_filter(
            array_unique([...array_keys($values), ...array_keys($before)]),
            fn (string $key) => json_encode($values[$key] ?? null) !== json_encode($before[$key] ?? null),
        ));

        foreach (Property::query()->whereIn('key', $changed)->get() as $property) {
            WorkItemValue::query()->where('work_item_id', $item->id)->where('property_id', $property->id)->delete();

            $value = $values[$property->key] ?? null;
            $list = is_array($value) && array_is_list($value) ? $value : [$value];
            foreach ($value === null ? [] : $list as $position => $one) {
                WorkItemValue::query()->create([
                    'work_item_id' => $item->id,
                    'property_id' => $property->id,
                    'position' => $position,
                    // a number goes as its exact decimal text: PDO writes a float with 14 digits (`precision`), which
                    // rounds a value near the limit of the column beyond it and cuts the digits of large numbers
                    self::column($property->field_type) => $property->field_type === FieldType::Number ? sprintf('%.4F', $one) : $one,
                    'value_text' => $property->field_type === FieldType::RichText ? Document::fromJson((array) $one)->toText() : null,
                ]);
            }
        }
    }

    /**
     * The values of the item as property key → value, from its loaded `values.property`: a number to the decimals of
     * its property (an integer when whole), a multiple choice as a list in `position` order, a day as `YYYY-MM-DD`.
     *
     * @return array<string, mixed>
     */
    public static function of(WorkItem $item): array
    {
        $values = [];

        foreach ($item->values->groupBy('property_id') as $rows) {
            /** @var Collection<int, WorkItemValue> $rows */
            $property = $rows->firstOrFail()->property;
            $list = $rows->sortBy('position')->map(fn (WorkItemValue $row) => self::read($property, $row))->values()->all();
            $values[$property->key] = ($property->settings['multiple'] ?? false) === true ? $list : $list[0];
        }

        return $values;
    }

    /**
     * The rich text values of the item as Markdown, property key → text, from its loaded `values.property`.
     *
     * @return array<string, string>
     */
    public static function markdown(WorkItem $item): array
    {
        $markdown = [];

        foreach ($item->values as $row) {
            if ($row->property->field_type === FieldType::RichText) {
                $markdown[$row->property->key] = Document::fromJson((array) $row->value_json)->toMarkdown();
            }
        }

        return $markdown;
    }

    /**
     * A rich text value as a document: a Document as it is, Markdown or JSON read; `null` when empty. A refusal is the
     * sentence of what is wrong.
     */
    private static function document(Property $property, mixed $value, MarkdownContext $ctx): Document|string|null
    {
        try {
            $document = match (true) {
                $value === null, $value instanceof Document => $value,
                is_string($value) => Document::fromMarkdown($value, $ctx),
                is_array($value) => Document::fromJson($value),
                default => throw new InvalidDocument('shape'),
            };
        } catch (InvalidDocument $invalid) {
            return $invalid->reason === 'size' ? __('field.rich_text.too_long') : self::message('rich_text', $property);
        }

        return $document === null || $document->isEmpty() ? null : $document;
    }

    /**
     * The default value of the property as an item takes it, when it is still valid (an option archived since then
     * is not offered anymore); `null` without one.
     */
    private static function default(Property $property): mixed
    {
        if ($property->default_value === null) {
            return null;
        }

        $normalized = ItemValue::normalize(self::shape($property), $property->default_value);

        return $normalized->ok() ? $normalized->value : null;
    }

    /**
     * Whether the people picked may be picked: anybody the item already has, as long as the account exists; anybody
     * new only when they can take work in the project.
     */
    private static function canPick(Project $project, mixed $value, mixed $current): bool
    {
        $ids = is_array($value) ? $value : [$value];
        $kept = is_array($current) ? $current : [$current];
        $users = User::query()->whereKey($ids)->get()->keyBy('id');

        foreach ($ids as $id) {
            $user = $users->get($id);
            if ($user === null || (! in_array($id, $kept, true) && ! Assignable::check($user, $project))) {
                return false;
            }
        }

        return true;
    }

    private static function shape(Property $property): PropertyShape
    {
        $active = $property->options->filter(fn (PropertyOption $option) => $option->archived_at === null);

        return new PropertyShape(
            $property->field_type,
            (int) ($property->settings['decimals'] ?? 0),
            ($property->settings['multiple'] ?? false) === true,
            array_values($active->map(fn (PropertyOption $option) => $option->id)->all()),
        );
    }

    private static function read(Property $property, WorkItemValue $row): mixed
    {
        return match ($property->field_type) {
            FieldType::Text, FieldType::Url => $row->value_string,
            FieldType::Number => ItemValue::normalize(new PropertyShape(FieldType::Number, (int) ($property->settings['decimals'] ?? 0), false, []), $row->value_number)->value,
            FieldType::Dropdown => $row->value_option_id,
            FieldType::Boolean => $row->value_bool,
            FieldType::Date => $row->value_date?->format('Y-m-d'),
            FieldType::Member => $row->value_user_id,
            FieldType::RichText => $row->value_json,
        };
    }

    private static function column(FieldType $type): string
    {
        return match ($type) {
            FieldType::Text, FieldType::Url => 'value_string',
            FieldType::Number => 'value_number',
            FieldType::Dropdown => 'value_option_id',
            FieldType::Boolean => 'value_bool',
            FieldType::Date => 'value_date',
            FieldType::Member => 'value_user_id',
            FieldType::RichText => 'value_json',
        };
    }

    private static function requiredMessage(Property $property): string
    {
        return __('field.values.required', ['label' => $property->label]);
    }

    /**
     * The sentence for what is wrong with a value (a fixed table, so the scan of used keys finds them).
     */
    private static function message(string $error, Property $property): string
    {
        $replace = ['label' => $property->label];

        return match ($error) {
            'text' => __('field.values.text', [...$replace, 'max' => ItemValue::TEXT_MAX]),
            'number' => __('field.values.number', $replace),
            'number_range' => __('field.values.number_range', $replace),
            'option' => __('field.values.option', $replace),
            'single' => __('field.values.single', $replace),
            'boolean' => __('field.values.boolean', $replace),
            'date' => __('field.values.date', $replace),
            'url' => __('field.values.url', $replace),
            'url_invalid' => __('field.values.url_invalid', $replace),
            'member' => __('field.values.member', $replace),
            default => __('field.values.rich_text', $replace),
        };
    }
}
