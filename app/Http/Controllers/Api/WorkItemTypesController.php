<?php

namespace App\Http\Controllers\Api;

use App\Actions\WorkItemTypes\DeleteWorkItemType;
use App\Actions\WorkItemTypes\ListWorkItemTypes;
use App\Actions\WorkItemTypes\SaveWorkItemType;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\WorkItemTypeResource;
use App\Models\WorkItemType;
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
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListWorkItemTypes::run(Actor::fromRequest($request), $request->query()), WorkItemTypeResource::class);
    }

    /** 201: the new type was just created. */
    public function store(Request $request): WorkItemTypeResource
    {
        return new WorkItemTypeResource(SaveWorkItemType::run(Actor::fromRequest($request), null, $request->all()));
    }

    public function update(Request $request, WorkItemType $workItemType): WorkItemTypeResource
    {
        return new WorkItemTypeResource(SaveWorkItemType::run(Actor::fromRequest($request), $workItemType, $request->all()));
    }

    /** 200 with what became of the type (without `data`): `deleted` (Phase 4: `archived` when items carry it). */
    public function destroy(Request $request, WorkItemType $workItemType): JsonResponse
    {
        return response()->json(DeleteWorkItemType::run(Actor::fromRequest($request), $workItemType));
    }
}
