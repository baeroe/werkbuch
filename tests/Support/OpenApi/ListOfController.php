<?php

namespace Tests\Support\OpenApi;

use App\Actions\Labels\ListLabels;
use App\Http\Api\ApiList;
use App\Http\Api\ListOf;
use App\Http\Resources\LabelResource;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Lists for `ListParametersTest`, documented through their own API (`list-test`) and never called.
 */
final class ListOfController
{
    #[ListOf(ListOfAction::class)]
    public function full(Request $request): JsonResponse
    {
        return ApiList::respond(ListLabels::run(Actor::fromRequest($request), $request->query()), LabelResource::class);
    }

    #[ListOf(ListOfAction::class, 'fixedSpec')]
    public function fixed(Request $request): JsonResponse
    {
        return ApiList::respond(ListLabels::run(Actor::fromRequest($request), $request->query()), LabelResource::class);
    }

    // a class without rules of a list: only the page
    #[ListOf(ListOfController::class)]
    public function plain(Request $request): JsonResponse
    {
        return ApiList::respond(ListLabels::run(Actor::fromRequest($request), $request->query()), LabelResource::class);
    }

    public function none(): JsonResponse
    {
        return response()->json(['ok' => true]);
    }
}
