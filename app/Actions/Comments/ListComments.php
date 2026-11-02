<?php

namespace App\Actions\Comments;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Comment;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The comments of a work item (`GET /api/v1/work-items/{item}/comments`, P3) for everybody who sees it: oldest first
 * (`created_at`, then id), a page at a time with a cursor; each loaded for CommentResource (Comment::loadForResource).
 * The item comes as a model or as a reference (ULID or key, also with a former identifier).
 */
final class ListComments
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $query  `cursor`, `per_page`
     * @return ListResult<Comment>
     *
     * @throws Problem 404 when the account does not see the item
     * @throws ValidationException at `cursor` or `per_page`
     */
    public function handle(Actor $actor, WorkItem|string $item, array $query): ListResult
    {
        $item = is_string($item) ? (WorkItem::findByReference($item) ?? throw Problem::notFound()) : $item;
        Authorize::check($actor, 'view', $item);
        $args = PageArgs::from($query);

        $result = ListResult::of(Comment::query()->where('work_item_id', $item->id)->orderBy('created_at')->orderBy('id'), $args);
        Comment::loadForResource(new Collection($result->page->items()), $actor->user);

        return $result;
    }
}
