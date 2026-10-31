<?php

namespace App\Http\Controllers\Api;

use App\Actions\Favorites\ListFavorites;
use App\Actions\Favorites\ToggleFavorite;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\FavoriteResource;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The own favorites: the list for the sidebar and the one switch that puts a project in or takes it out.
 */
final class FavoritesController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListFavorites::run(Actor::fromRequest($request), $request->query()), FavoriteResource::class);
    }

    /** Answers the new state `{kind, id, favorite}`, without `data` (it is no resource). */
    public function toggle(Request $request): JsonResponse
    {
        return response()->json(ToggleFavorite::run(Actor::fromRequest($request), $request->all()));
    }
}
