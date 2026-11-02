<?php

namespace App\Domain\Filter;

/**
 * One condition of a filter: a field, an operator and the value in its normal form (`null` for operators without one).
 */
final readonly class Condition
{
    /**
     * @param  Field|null  $resolved  the field the name stands for; `null` when there is none (any more) or the stored
     *                                condition does not fit the schema: such a condition matches nothing
     */
    public function __construct(
        public string $field,
        public Op $op,
        public mixed $value,
        public ?Field $resolved,
    ) {}

    /**
     * @return array{field: string, op: string, value?: mixed}
     */
    public function toArray(): array
    {
        return $this->op->takesValue()
            ? ['field' => $this->field, 'op' => $this->op->value, 'value' => $this->value]
            : ['field' => $this->field, 'op' => $this->op->value];
    }
}
