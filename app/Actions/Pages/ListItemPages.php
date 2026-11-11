<?php

namespace App\Actions\Pages;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\PageItemReference;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The wiki pages that name a work item (`GET /api/v1/work-items/{item}/pages`, A456) for everybody who sees it: the
 * pages whose current text references the item (`page_item_references`), only those of the projects the reader sees
 * (archived ones too, never one being deleted), by title (the collation), then the ULID, a page at a time, lean
 * (`content` and `content_text` are never read). The total counts only what the reader sees: a page of a project they
 * do not see tells of itself in nothing, not even as a number. The item comes as a model or as a reference (ULID or
 * key, also with a former identifier).
 */
final class ListItemPages
{
    use AsAction;

    /** A fixed list (A386, K12): no filter, sort or include; it keeps the order it has. */
    public static function spec(): ListSpec
    {
        return ListSpec::fixed();
    }

    /**
     * @param  array<array-key, mixed>  $query  `cursor`, `per_page`
     * @return ListResult<Page>
     *
     * @throws Problem 404 when the account does not see the item
     * @throws ValidationException at `cursor` or `per_page`
     */
    public function handle(Actor $actor, WorkItem|string $item, array $query): ListResult
    {
        $item = is_string($item) ? (WorkItem::findByReference($item) ?? throw Problem::notFound()) : $item;
        Authorize::check($actor, 'view', $item);
        $args = PageArgs::from($query);

        $pages = Page::query()->visibleTo($actor->user)
            ->whereIn('pages.id', PageItemReference::query()->where('work_item_id', $item->id)->select('page_id'))
            ->select((new Page)->qualifyColumns(Page::LEAN_COLUMNS))
            ->orderBy('pages.title')->orderBy('pages.id');

        [$pages, $signature] = ListQuery::apply($pages, $query, self::spec());
        $result = ListResult::of($pages, $args, $signature);
        Page::loadForResource(new Collection($result->page->items()), $actor->user, lean: true);

        return $result;
    }
}
