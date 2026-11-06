<?php

namespace App\Support;

use Closure;
use Illuminate\Database\Eloquent\Builder;

/**
 * One filter of a list (`filter[<name>]`, A386), part of its `ListSpec`.
 *
 * - `exact`: the column equals the value; several values separated by commas match any of them (`filter[type]=person,bot`);
 *   with `values` only those;
 * - `partial`: the column contains the text (`like`, `\`, `%` and `_` masked; a comma is part of the text, K11);
 * - `boolean`: the column is true or false, the value as Laravel's `boolean` reads it (`1`, `0`);
 * - `scope`: a rule of its own, called with the value in the form of `type` (`string`, `boolean`, a `list<string>`
 *   from a text separated by commas).
 *
 * `type` and `values` describe the filter in the document (`ListParameters`). A filter only narrows the rows the
 * action reads anyway: what the reader may not see stays out before it (P3).
 */
final readonly class ListFilter
{
    public const EXACT = 'exact';

    public const PARTIAL = 'partial';

    public const BOOLEAN = 'boolean';

    public const SCOPE = 'scope';

    /** The types of the value of a scope. */
    public const TYPES = ['string', 'boolean', 'list<string>'];

    /**
     * @param  list<string>|null  $values
     * @param  (Closure(Builder<*>, mixed): mixed)|null  $apply
     */
    private function __construct(
        public string $name,
        public string $kind,
        public string $column,
        public ?array $values,
        public string $type,
        public ?Closure $apply,
    ) {}

    /**
     * @param  list<string>|null  $values  the values it takes (the enum of the document), or any text
     */
    public static function exact(string $name, ?string $column = null, ?array $values = null): self
    {
        return new self($name, self::EXACT, $column ?? $name, $values, 'list<string>', null);
    }

    public static function partial(string $name, ?string $column = null): self
    {
        return new self($name, self::PARTIAL, $column ?? $name, null, 'string', null);
    }

    public static function boolean(string $name, ?string $column = null): self
    {
        return new self($name, self::BOOLEAN, $column ?? $name, null, 'boolean', null);
    }

    /**
     * @param  'string'|'boolean'|'list<string>'  $type
     * @param  Closure(Builder<*>, mixed): mixed  $apply  narrows the query by the value
     */
    public static function scope(string $name, string $type, Closure $apply): self
    {
        return new self($name, self::SCOPE, $name, null, $type, $apply);
    }
}
