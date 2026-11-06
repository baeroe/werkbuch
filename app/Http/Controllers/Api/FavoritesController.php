<?php

namespace App\Http\Controllers\Api;

use App\Actions\Favorites\ListFavorites;
use App\Actions\Favorites\ToggleFavorite;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\FavoriteResource;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The own favorites: the list for the sidebar and the one switch that puts a project in or takes it out.
 */
final class FavoritesController extends Controller
{
    /**
     * List the own favorites: projects and views in one order.
     */
    #[ListOf(ListFavorites::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListFavorites::run(Actor::fromRequest($request), $request->query()), FavoriteResource::class);
    }

    /**
     * Toggle a favorite: a project or a view of the own account.
     *
     * Answers the new state `{kind, id, favorite}`, without `data` (it is no resource).
     */
    #[Body(CatalogSchemas::class, 'favoriteToggle')]
    #[Answer(200, CatalogSchemas::class, 'favoriteToggled', 'The new state of the favorite.')]
    public function toggle(Request $request): JsonResponse
    {
        return response()->json(ToggleFavorite::run(Actor::fromRequest($request), $request->all()));
    }
}
