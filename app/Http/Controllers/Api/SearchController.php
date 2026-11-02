<?php

namespace App\Http\Controllers\Api;

use App\Actions\Search\QuerySearch;
use App\Http\Controllers\Controller;
use App\Http\Resources\SearchResultsResource;
use App\Support\Actor;
use Illuminate\Http\Request;

/**
 * `GET /api/v1/search?q=…` (`types`, `limit`, `include_archived`): items, projects, people and views at once. What the
 * account may see, the action decides.
 */
final class SearchController extends Controller
{
    /** @return array{data: SearchResultsResource} */
    public function __invoke(Request $request): array
    {
        return ['data' => new SearchResultsResource(QuerySearch::run(Actor::fromRequest($request), $request->query()))];
    }
}
