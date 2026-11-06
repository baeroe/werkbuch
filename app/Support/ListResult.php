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
     * The cursor is checked first (`SignedCursor`): a list with a signature (`ListQuery`, K12) takes only cursors of
     * the same order and writes its signature into the cursors of its page; a list without one only cursors without.
     *
     * @template TOf of Model
     *
     * @param  Builder<TOf>  $query
     * @param  string  $signature  the signature `ListQuery::apply` gave, `''` for a list it does not order
     * @return self<TOf>
     *
     * @throws ValidationException at `cursor` for a cursor that does not read, of another order or of another list
     *                             (it lacks a column of this order)
     */
    public static function of(Builder $query, PageArgs $args, string $signature = ''): self
    {
        $cursor = SignedCursor::decode($args->cursor, $signature);
        $total = (clone $query)->toBase()->getCountForPagination();

        try {
            // never `null`: the paginator would read the cursor of the request instead, unchecked
            $page = $query->cursorPaginate($args->perPage, cursor: $cursor ?? '');
        } catch (UnexpectedValueException) {
            throw ValidationException::withMessages(['cursor' => __('field.cursor.invalid')]);
        }

        if ($signature !== '') {
            // Laravel names only the columns of the order in a cursor; the signature joins them, read off each row
            // (`? as _sig`), so `next_cursor`, `prev_cursor` and the links carry it
            (fn () => $this->parameters[] = SignedCursor::KEY)->call($page);
        }

        return new self($page, $total);
    }
}
