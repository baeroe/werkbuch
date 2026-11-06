<?php

namespace App\Http\Controllers\Api;

use App\Actions\WorkItemTypes\DeleteWorkItemType;
use App\Actions\WorkItemTypes\GetWorkItemType;
use App\Actions\WorkItemTypes\ListWorkItemTypes;
use App\Actions\WorkItemTypes\SaveWorkItemType;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\WorkItemTypeResource;
use App\Models\WorkItemType;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The work item types of the organization. `{workItemType}` is bound by ULID (a placeholder named after its model:
 * `{project}` has a global binding, and `{type}` would collide with the input field `type`, because `$request->type`
 * reads the input before the route parameter); saving replaces a type as a whole (`PUT`).
 */
final class WorkItemTypesController extends Controller
{
    /**
     * List the work item types, archived ones too.
     */
    #[ListOf(ListWorkItemTypes::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListWorkItemTypes::run(Actor::fromRequest($request), $request->query()), WorkItemTypeResource::class);
    }

    /**
     * Read a work item type, also an archived one.
     */
    public function show(Request $request, WorkItemType $workItemType): WorkItemTypeResource
    {
        return new WorkItemTypeResource(GetWorkItemType::run(Actor::fromRequest($request), $workItemType));
    }

    /**
     * Create a work item type (org admins).
     */
    #[Body(CatalogSchemas::class, 'workItemType')]
    public function store(Request $request): JsonResponse
    {
        return (new WorkItemTypeResource(SaveWorkItemType::run(Actor::fromRequest($request), null, $request->all())))->response()->setStatusCode(201);
    }

    /**
     * Replace a work item type as a whole (org admins).
     */
    #[Body(CatalogSchemas::class, 'workItemType')]
    public function update(Request $request, WorkItemType $workItemType): WorkItemTypeResource
    {
        return new WorkItemTypeResource(SaveWorkItemType::run(Actor::fromRequest($request), $workItemType, $request->all()));
    }

    /**
     * Delete a work item type, or archive it when items carry it.
     */
    #[Answer(200, CatalogSchemas::class, 'deleteOutcome', 'What became of the type.')]
    public function destroy(Request $request, WorkItemType $workItemType): JsonResponse
    {
        return response()->json(DeleteWorkItemType::run(Actor::fromRequest($request), $workItemType));
    }
}
