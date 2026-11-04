<?php

namespace App\Http\Resources;

use App\Search\SearchResults;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The hits of a search (P5): `items` (lean WorkItemResources), `pages` (lean PageResources), `projects`, `people` and `views` in the order of their
 * hits, every key always there (kinds not asked for are empty), and `key_match`, the ULID of the item a typed key names
 * or `null`. Asks the database nothing: QuerySearch loaded everything.
 *
 * @mixin SearchResults
 */
final class SearchResultsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var SearchResults $results */
        $results = $this->resource;

        return [
            'items' => WorkItemResource::collection($results->items),
            'pages' => PageResource::collection($results->pages),
            'projects' => ProjectResource::collection($results->projects),
            'people' => UserResource::collection($results->people),
            'views' => ViewResource::collection($results->views),
            'key_match' => $results->keyMatch,
        ];
    }
}
