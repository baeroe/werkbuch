<?php

namespace App\Domain\Properties;

/**
 * The outcome of normalizing a value: the value as it is stored, or the code of what is wrong with it.
 */
final readonly class NormalizedValue
{
    public function __construct(
        public mixed $value,
        public ?string $error = null,
    ) {}

    public function ok(): bool
    {
        return $this->error === null;
    }
}
