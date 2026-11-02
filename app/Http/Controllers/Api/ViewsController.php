<?php

namespace App\Http\Controllers\Api;

use App\Actions\Views\DeleteView;
use App\Actions\Views\GetView;
use App\Actions\Views\ListViews;
use App\Actions\Views\SaveView;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\ViewResource;
use App\Models\View;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The views of the team. `{view}` is bound by ULID only (any case); saving replaces a view as a whole (`PUT`).
 */
final class ViewsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListViews::run(Actor::fromRequest($request), $request->query()), ViewResource::class);
    }

    /** 201: the new view was just created. */
    public function store(Request $request): ViewResource
    {
        return new ViewResource(SaveView::run(Actor::fromRequest($request), $request->all()));
    }

    public function show(Request $request, View $view): ViewResource
    {
        return new ViewResource(GetView::run(Actor::fromRequest($request), $view));
    }

    public function update(Request $request, View $view): ViewResource
    {
        return new ViewResource(SaveView::run(Actor::fromRequest($request), $request->all(), $view));
    }

    /** 204. */
    public function destroy(Request $request, View $view): Response
    {
        DeleteView::run(Actor::fromRequest($request), $view);

        return response()->noContent();
    }
}
