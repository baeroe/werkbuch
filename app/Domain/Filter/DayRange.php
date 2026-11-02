<?php

namespace App\Domain\Filter;

/**
 * Days from `from` to `to`, both included: `today` is one day, `this_week` seven. `is` means inside, `before` before
 * the first day, `after` after the last.
 */
final readonly class DayRange implements Operand
{
    public function __construct(
        public string $from,
        public string $to,
    ) {}
}
