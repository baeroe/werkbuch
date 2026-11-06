<?php

namespace App\Http\Controllers\Api;

use App\Actions\Resolutions\DeleteResolution;
use App\Actions\Resolutions\GetResolution;
use App\Actions\Resolutions\ListResolutions;
use App\Actions\Resolutions\SaveResolution;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\ResolutionResource;
use App\Models\Resolution;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The resolutions of the organization. `{resolution}` is bound by ULID; saving replaces a resolution as a whole (`PUT`).
 */
final class ResolutionsController extends Controller
{
    /**
     * List the resolutions by position, archived ones too.
     */
    #[ListOf(ListResolutions::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListResolutions::run(Actor::fromRequest($request), $request->query()), ResolutionResource::class);
    }

    /**
     * Read a resolution, also an archived one.
     */
    public function show(Request $request, Resolution $resolution): ResolutionResource
    {
        return new ResolutionResource(GetResolution::run(Actor::fromRequest($request), $resolution));
    }

    /**
     * Create a resolution (org admins).
     */
    #[Body(CatalogSchemas::class, 'resolution')]
    public function store(Request $request): JsonResponse
    {
        return (new ResolutionResource(SaveResolution::run(Actor::fromRequest($request), null, $request->all())))->response()->setStatusCode(201);
    }

    /**
     * Replace a resolution as a whole (org admins).
     */
    #[Body(CatalogSchemas::class, 'resolution')]
    public function update(Request $request, Resolution $resolution): ResolutionResource
    {
        return new ResolutionResource(SaveResolution::run(Actor::fromRequest($request), $resolution, $request->all()));
    }

    /**
     * Delete a resolution, or archive it when items carry it. A default is 409 `is_default`.
     */
    #[Answer(200, CatalogSchemas::class, 'deleteOutcome', 'What became of the resolution.')]
    public function destroy(Request $request, Resolution $resolution): JsonResponse
    {
        return response()->json(DeleteResolution::run(Actor::fromRequest($request), $resolution));
    }
}
