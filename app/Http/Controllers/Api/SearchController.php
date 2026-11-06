<?php

namespace App\Http\Controllers\Api;

use App\Actions\Search\QuerySearch;
use App\Http\Controllers\Controller;
use App\Http\Resources\SearchResultsResource;
use App\Support\Actor;
use Illuminate\Http\Request;

/**
 * The search over items, wiki pages, projects, people and views at once. What the account may see, the action decides.
 */
final class SearchController extends Controller
{
    /**
     * Search.
     *
     * Items, wiki pages, projects, people and views in one call, up to `limit` hits of each kind. What the account does not see
     * never comes back, also not from the index. A kind that was not asked for is empty. When the search engine does not
     * answer, this is 503 `search_unavailable`.
     *
     * @return array{data: SearchResultsResource}
     */
    public function __invoke(Request $request): array
    {
        return ['data' => new SearchResultsResource(QuerySearch::run(Actor::fromRequest($request), $request->only(QuerySearch::KEYS)))];
    }
}
