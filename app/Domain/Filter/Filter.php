<?php

namespace App\Domain\Filter;

/**
 * A filter (spec 4.11, schema `version: 1`): conditions joined with AND. No conditions match every item.
 */
final readonly class Filter
{
    /**
     * @param  list<Condition>  $conditions
     */
    public function __construct(public array $conditions) {}

    public static function empty(): self
    {
        return new self([]);
    }

    /** Both filters at once: the conditions of this one, then those of the other. */
    public function and(self $other): self
    {
        return new self([...$this->conditions, ...$other->conditions]);
    }

    /** Whether a condition names the field (`archived`, `property:customer`). */
    public function mentions(string $field): bool
    {
        foreach ($this->conditions as $condition) {
            if ($condition->field === $field) {
                return true;
            }
        }

        return false;
    }

    /**
     * The ULIDs a `project` condition with `is` or `in` names, each once in the order of the conditions.
     *
     * @return list<string>
     */
    public function namedProjects(): array
    {
        $ids = [];
        foreach ($this->conditions as $condition) {
            if ($condition->resolved?->name === CoreField::Project->value && ($condition->op === Op::Is || $condition->op === Op::In)) {
                $ids = [...$ids, ...(array) $condition->value];
            }
        }

        /** @var list<string> */
        return array_values(array_unique($ids));
    }

    /**
     * The normal form, as views store it.
     *
     * @return array{version: 1, conditions: list<array{field: string, op: string, value?: mixed}>}
     */
    public function toArray(): array
    {
        return ['version' => 1, 'conditions' => array_map(fn (Condition $condition) => $condition->toArray(), $this->conditions)];
    }
}
