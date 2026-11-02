<?php

namespace App\Domain\Filter;

/**
 * A plain value of a condition: a ULID (also the one `me` stands for), a word, a text, a number or yes or no.
 */
final readonly class Scalar implements Operand
{
    public function __construct(public string|int|float|bool $value) {}
}
