<?php

namespace App\Http\Resources;

use App\Models\Page;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A node of the tree of a wiki (`PageNode` in resources/js/types.ts, A315): the lean page (PageResource without text)
 * and its `children`, nested all the way down. tree() builds the levels from the pages of one query; the resource asks
 * the database nothing (K5).
 *
 * @mixin Page
 */
final class PageNodeResource extends JsonResource
{
    /**
     * The pages at the top of the tree, each with its children set from `$pages` (all pages of one project, lean, the
     * siblings in their order): no page asks for its children.
     *
     * @param  Collection<int, Page>  $pages
     */
    public static function tree(Collection $pages): AnonymousResourceCollection
    {
        $below = $pages->groupBy(fn (Page $page) => $page->parent_id ?? '');
        $pages->each(fn (Page $page) => $page->setRelation('children', $below->get($page->id, $pages->make())->values()));

        return self::collection($below->get('', $pages->make())->values());
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Page $page */
        $page = $this->resource;

        return [...(new PageResource($page))->toArray($request), 'children' => self::collection($page->children)];
    }
}
