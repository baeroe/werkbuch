<?php

namespace App\Domain\Properties;

/**
 * What `ItemValue` needs to know of a property: its field type, decimals, whether it takes several values and the
 * options that are not archived.
 */
final readonly class PropertyShape
{
    public function __construct(
        public FieldType $type,
        public int $decimals,
        public bool $multiple,
        /** @var list<string> */
        public array $activeOptionIds,
    ) {}
}
