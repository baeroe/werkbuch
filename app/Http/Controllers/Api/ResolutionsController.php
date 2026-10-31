<?php

namespace App\Http\Controllers\Api;

use App\Actions\Resolutions\DeleteResolution;
use App\Actions\Resolutions\ListResolutions;
use App\Actions\Resolutions\SaveResolution;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\ResolutionResource;
use App\Models\Resolution;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The resolutions of the organization. `{resolution}` is bound by ULID; saving replaces a resolution as a whole (`PUT`).
 */
final class ResolutionsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListResolutions::run(Actor::fromRequest($request), $request->query()), ResolutionResource::class);
    }

    /** 201: the new resolution was just created. */
    public function store(Request $request): ResolutionResource
    {
        return new ResolutionResource(SaveResolution::run(Actor::fromRequest($request), null, $request->all()));
    }

    public function update(Request $request, Resolution $resolution): ResolutionResource
    {
        return new ResolutionResource(SaveResolution::run(Actor::fromRequest($request), $resolution, $request->all()));
    }

    /** 200 with what became of the resolution (without `data`): `deleted` (Phase 4: `archived` when items carry it). */
    public function destroy(Request $request, Resolution $resolution): JsonResponse
    {
        return response()->json(DeleteResolution::run(Actor::fromRequest($request), $resolution));
    }
}
