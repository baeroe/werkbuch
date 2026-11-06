<?php

namespace App\Http\Controllers\Api;

use App\Actions\Views\DeleteView;
use App\Actions\Views\GetView;
use App\Actions\Views\ListViews;
use App\Actions\Views\SaveView;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\ViewResource;
use App\Models\View;
use App\OpenApi\ContentSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The views of the team. `{view}` is bound by ULID only (any case); saving replaces a view as a whole (`PUT`).
 */
final class ViewsController extends Controller
{
    /**
     * List the views.
     *
     * Every view of the team, by name; every account reads them.
     */
    #[ListOf(ListViews::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListViews::run(Actor::fromRequest($request), $request->query()), ViewResource::class);
    }

    /**
     * Create a view.
     *
     * Every active account may (`view.create` belongs to both org roles, bots included). 201.
     */
    #[Body(ContentSchemas::class, 'view')]
    public function store(Request $request): JsonResponse
    {
        return (new ViewResource(SaveView::run(Actor::fromRequest($request), $request->all())))->response()->setStatusCode(201);
    }

    /**
     * Read a view.
     *
     * As stored.
     */
    public function show(Request $request, View $view): ViewResource
    {
        return new ViewResource(GetView::run(Actor::fromRequest($request), $view));
    }

    /**
     * Replace a view.
     *
     * As a whole (all four keys); only its creator or an org admin. The same view changes nothing (no event).
     */
    #[Body(ContentSchemas::class, 'view')]
    public function update(Request $request, View $view): ViewResource
    {
        return new ViewResource(SaveView::run(Actor::fromRequest($request), $request->all(), $view));
    }

    /**
     * Delete a view.
     *
     * Only its creator or an org admin; the stars of everyone go with it. 204.
     */
    public function destroy(Request $request, View $view): Response
    {
        DeleteView::run(Actor::fromRequest($request), $view);

        return response()->noContent();
    }
}
