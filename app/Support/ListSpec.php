<?php

namespace App\Support;

/**
 * The rules of a list (A386), at one place: the list action gives them (`public static function spec(): ListSpec`),
 * `ListQuery` builds the query by them and `ListParameters` documents them (`#[ListOf]`).
 *
 * - `filters`: the filters by name (`filter[<name>]`);
 * - `sorts`: name → the column it orders by (qualified where the query joins, or an alias of its select); never a
 *   column that can be `null`. Every sort ends on the ULID;
 * - `default`: the sort without `sort` in the query (`-type`, `name`), names of `sorts`;
 * - `includes`: the relations `include` may load.
 *
 * - `sortable`: whether `sort` is a parameter of the list; a list that is not (the inbox, the log) keeps its `default`
 *   order, `sort` is unknown there as on a fixed list;
 * - `tiebreak`: the direction of the ULID that ends the order (`desc` where the newest of equal stamps comes first).
 *
 * A fixed list (`fixed()`: the comments, the history, the notifications …) takes no filter, sort or include and keeps
 * the order its action gives it, with no second one (K12).
 */
final readonly class ListSpec
{
    /** @var array<string, ListFilter> */
    public array $filters;

    /**
     * @param  array<array-key, ListFilter>  $filters
     * @param  array<string, string>  $sorts
     * @param  list<string>  $default
     * @param  list<string>  $includes
     */
    public function __construct(
        array $filters = [],
        public array $sorts = [],
        public array $default = [],
        public array $includes = [],
        public bool $fixed = false,
        public bool $sortable = true,
        /** @var 'asc'|'desc' */
        public string $tiebreak = 'asc',
    ) {
        $byName = [];
        foreach ($filters as $filter) {
            $byName[$filter->name] = $filter;
        }
        $this->filters = $byName;
    }

    public static function fixed(): self
    {
        return new self(fixed: true);
    }
}
