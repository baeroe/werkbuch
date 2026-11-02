<?php

namespace App\Domain\Filter;

use App\Domain\Properties\FieldType;
use App\Domain\Properties\PropertyShape;

/**
 * A field a condition names, resolved: a core field or a property, with its kind and what it takes.
 */
final readonly class Field
{
    /** How a condition names a property: `property:<key>`. */
    public const PROPERTY_PREFIX = 'property:';

    private function __construct(
        public string $name,
        public FieldKind $kind,
        public bool $nullable,
        public bool $acceptsMe,
        public ?string $propertyKey = null,
        public ?FieldType $propertyType = null,
    ) {}

    public static function core(CoreField $field): self
    {
        return new self($field->value, $field->kind(), $field->nullable(), $field->acceptsMe());
    }

    /** A property as `fieldOps.ts` of the clickdummy files it; every property but yes or no can be empty. */
    public static function property(string $key, PropertyShape $shape): self
    {
        $kind = match ($shape->type) {
            FieldType::Dropdown, FieldType::Member => $shape->multiple ? FieldKind::List : FieldKind::Id,
            FieldType::Date => FieldKind::Date,
            FieldType::Boolean => FieldKind::Flag,
            FieldType::Number => FieldKind::Number,
            FieldType::Text, FieldType::Url => FieldKind::Text,
            FieldType::RichText => FieldKind::Rich,
        };

        return new self(
            self::PROPERTY_PREFIX.$key,
            $kind,
            $shape->type !== FieldType::Boolean,
            $shape->type === FieldType::Member,
            $key,
            $shape->type,
        );
    }

    /** The field a name stands for: a core field or a property of the catalog; `null` when there is none. */
    public static function named(string $name, PropertyCatalog $catalog): ?self
    {
        $core = CoreField::tryFrom($name);
        if ($core !== null) {
            return self::core($core);
        }
        if (! str_starts_with($name, self::PROPERTY_PREFIX)) {
            return null;
        }

        $key = substr($name, strlen(self::PROPERTY_PREFIX));
        $shape = $catalog->shape($key);

        return $shape === null ? null : self::property($key, $shape);
    }

    /**
     * The operators of the field, in the order of the operator menu.
     *
     * @return list<Op>
     */
    public function ops(): array
    {
        return array_values(array_filter($this->kind->ops(), fn (Op $op): bool => match (true) {
            $this->name === CoreField::Title->value => $op === Op::Contains,
            $op === Op::Overdue => $this->name === CoreField::DueDate->value,
            $op === Op::IsEmpty, $op === Op::IsNotEmpty => $this->nullable,
            default => true,
        }));
    }
}
