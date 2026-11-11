<?php

namespace App\Domain\Views;

use App\Domain\Filter\Field;
use App\Domain\Filter\InvalidInput;
use App\Domain\Filter\PropertyCatalog;

/**
 * The schema of a display, `{layout, group_by, sort, fields, show_sub_items}`, all five required: `parse` checks input
 * strictly, `read` reads a stored display without ever refusing it.
 *
 * Codes, at paths relative to the display: `shape` (no object, or a key it does not know; at `''`), `invalid` (at
 * `layout`, `group_by`, `sort`, `fields`, `fields.<n>`, `show_sub_items`: missing or of the wrong form), `too_many`
 * (more than `MAX_FIELDS` fields, at `fields`). A field is one of `FIELDS` or `property:<key>` of any property of the
 * catalog; doubles are dropped, the order stays.
 */
final class DisplaySchema
{
    /** The fields of every item a row, card or column can show. */
    public const FIELDS = ['key', 'title', 'state', 'assignee', 'priority', 'labels', 'start_date', 'due_date', 'project', 'created_at', 'updated_at'];

    public const MAX_FIELDS = 30;

    /** The fields a list shows when a stored display has none to read (`DEFAULT_FIELDS` of `viewState.ts`, a test compares them, T2-M1). */
    public const DEFAULT_FIELDS = ['key', 'state', 'priority', 'labels', 'due_date', 'assignee'];

    private const KEYS = ['layout', 'group_by', 'sort', 'fields', 'show_sub_items'];

    /**
     * @throws InvalidInput
     */
    public static function parse(mixed $raw, PropertyCatalog $catalog): Display
    {
        if (! is_array($raw) || ($raw !== [] && array_is_list($raw)) || array_diff(array_keys($raw), self::KEYS) !== []) {
            throw new InvalidInput(['' => 'shape']);
        }

        $errors = [];

        $layout = is_string($raw['layout'] ?? null) ? Layout::tryFrom($raw['layout']) : null;
        if ($layout === null) {
            $errors['layout'] = 'invalid';
        }

        $groupBy = is_string($raw['group_by'] ?? null) ? GroupBy::tryFrom($raw['group_by']) : null;
        if ($groupBy === null) {
            $errors['group_by'] = 'invalid';
        }

        $sort = null;
        try {
            $sort = SortSpec::parse($raw['sort'] ?? null, $catalog);
        } catch (InvalidInput) {
            $errors['sort'] = 'invalid';
        }

        $fields = $raw['fields'] ?? null;
        if (! is_array($fields) || ! array_is_list($fields)) {
            $errors['fields'] = 'invalid';
        } elseif (count($fields) > self::MAX_FIELDS) {
            $errors['fields'] = 'too_many';
        } else {
            foreach ($fields as $index => $field) {
                if (! self::known($field, $catalog)) {
                    $errors["fields.{$index}"] = 'invalid';
                }
            }
        }

        $showSubItems = $raw['show_sub_items'] ?? null;
        if (! is_bool($showSubItems)) {
            $errors['show_sub_items'] = 'invalid';
        }

        if ($errors !== [] || $layout === null || $groupBy === null || $sort === null || ! is_array($fields) || ! is_bool($showSubItems)) {
            throw new InvalidInput($errors);
        }

        return new Display($layout, $groupBy, $sort, self::fields($fields, $catalog), $showSubItems);
    }

    /**
     * A stored display: unknown fields and properties that are gone drop out; a layout, grouping, sort or switch
     * that does not fit (any more) reads as the plain list (layout list, no grouping, the manual order, sub-items
     * shown).
     *
     * @param  array<mixed>  $stored
     */
    public static function read(array $stored, PropertyCatalog $catalog): Display
    {
        $layout = is_string($stored['layout'] ?? null) ? Layout::tryFrom($stored['layout']) : null;
        $groupBy = is_string($stored['group_by'] ?? null) ? GroupBy::tryFrom($stored['group_by']) : null;
        $sort = is_array($stored['sort'] ?? null) ? SortSpec::read($stored['sort'], $catalog) : SortSpec::manual();
        $fields = is_array($stored['fields'] ?? null) && array_is_list($stored['fields']) ? self::fields($stored['fields'], $catalog) : self::DEFAULT_FIELDS;
        $showSubItems = $stored['show_sub_items'] ?? null;

        return new Display($layout ?? Layout::List, $groupBy ?? GroupBy::None, $sort, $fields, is_bool($showSubItems) ? $showSubItems : true);
    }

    /**
     * The known fields, each once in the order given.
     *
     * @param  array<mixed>  $fields
     * @return list<string>
     */
    private static function fields(array $fields, PropertyCatalog $catalog): array
    {
        $known = [];
        foreach ($fields as $field) {
            if (self::known($field, $catalog) && ! in_array($field, $known, true)) {
                $known[] = $field;
            }
        }

        /** @var list<string> $known */
        return $known;
    }

    private static function known(mixed $field, PropertyCatalog $catalog): bool
    {
        if (! is_string($field)) {
            return false;
        }

        return in_array($field, self::FIELDS, true)
            || (str_starts_with($field, Field::PROPERTY_PREFIX) && Field::named($field, $catalog) !== null);
    }
}
