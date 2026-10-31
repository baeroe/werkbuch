<?php

namespace App\Support;

use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\ValidationException;
use UnexpectedValueException;

/**
 * One page of a list plus the number of all matches (P12): cursor pagination knows no total of its own, the screens
 * of the clickdummy show it. The query brings its order, ending in a unique column (the ULID).
 *
 * @template TModel of Model
 */
final readonly class ListResult
{
    /**
     * @param  CursorPaginator<int, TModel>  $page
     */
    public function __construct(public CursorPaginator $page, public int $total) {}

    /**
     * Counts the matches once and fetches the page the arguments name.
     *
     * @template TOf of Model
     *
     * @param  Builder<TOf>  $query
     * @return self<TOf>
     *
     * @throws ValidationException at `cursor` for a cursor of another list (it lacks a column of this order)
     */
    public static function of(Builder $query, PageArgs $args): self
    {
        $total = (clone $query)->toBase()->getCountForPagination();

        try {
            $page = $query->cursorPaginate($args->perPage, cursor: $args->cursor);
        } catch (UnexpectedValueException) {
            throw ValidationException::withMessages(['cursor' => __('field.cursor.invalid')]);
        }

        return new self($page, $total);
    }
}
