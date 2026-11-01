<?php

namespace App\Domain\Views;

use App\Domain\Filter\Field;
use App\Domain\Filter\InvalidInput;
use App\Domain\Filter\PropertyCatalog;
use App\Domain\Properties\FieldType;

/**
 * The order of a list (plan, table "Sortierung"): a core field of `CORE` or a property `property:<key>` of the types
 * number, date, text or address, ascending or descending. Every order ends on rank and id; `rank` alone is the manual
 * order.
 *
 * `parse` and `fromQuery` refuse anything else with `InvalidInput` (`['' => 'invalid']`, relative to the sort); `read`
 * turns a stored sort that does not fit (any more) into the manual order.
 */
final readonly class SortSpec
{
    public const CORE = ['rank', 'priority', 'due_date', 'start_date', 'created_at', 'updated_at', 'key', 'state_category'];

    /** The types of properties a list can sort by. */
    private const SORTABLE = [FieldType::Number, FieldType::Date, FieldType::Text, FieldType::Url];

    public function __construct(
        public string $field,
        public bool $descending,
    ) {}

    public static function manual(): self
    {
        return new self('rank', false);
    }

    /**
     * `{field, direction: asc|desc}`.
     *
     * @throws InvalidInput
     */
    public static function parse(mixed $raw, PropertyCatalog $catalog): self
    {
        $valid = is_array($raw) && count($raw) === 2 && array_key_exists('field', $raw) && array_key_exists('direction', $raw);
        $field = $valid && is_string($raw['field']) ? $raw['field'] : null;
        $direction = $valid ? $raw['direction'] : null;

        if ($field === null || ! in_array($direction, ['asc', 'desc'], true) || ! self::sortable($field, $catalog)) {
            throw new InvalidInput(['' => 'invalid']);
        }

        return new self($field, $direction === 'desc');
    }

    /**
     * The sort of a query string: `due_date`, `-due_date` (descending), `property:effort`.
     *
     * @throws InvalidInput
     */
    public static function fromQuery(string $raw, PropertyCatalog $catalog): self
    {
        $descending = str_starts_with($raw, '-');
        $field = $descending ? substr($raw, 1) : $raw;

        if (! self::sortable($field, $catalog)) {
            throw new InvalidInput(['' => 'invalid']);
        }

        return new self($field, $descending);
    }

    /**
     * @param  array<mixed>  $stored
     */
    public static function read(array $stored, PropertyCatalog $catalog): self
    {
        try {
            return self::parse($stored, $catalog);
        } catch (InvalidInput) {
            return self::manual();
        }
    }

    /** The sort in one word, as cursors carry it: `due_date:desc`. */
    public function signature(): string
    {
        return $this->field.':'.($this->descending ? 'desc' : 'asc');
    }

    /**
     * @return array{field: string, direction: 'asc'|'desc'}
     */
    public function toArray(): array
    {
        return ['field' => $this->field, 'direction' => $this->descending ? 'desc' : 'asc'];
    }

    private static function sortable(string $field, PropertyCatalog $catalog): bool
    {
        if (in_array($field, self::CORE, true)) {
            return true;
        }

        $property = str_starts_with($field, Field::PROPERTY_PREFIX) ? Field::named($field, $catalog) : null;

        return $property !== null && in_array($property->propertyType, self::SORTABLE, true);
    }
}
