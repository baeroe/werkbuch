<?php

namespace App\Http\Controllers\Api;

use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\GetWorkItem;
use App\Actions\WorkItems\ListWorkItems;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\WorkItemResource;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The work items. `{item}` is bound by ULID or key (`WEB-12`, any case, also with a former identifier, routes/api.php);
 * whether the account sees the item, the action decides. Every item leaves through WorkItem::loadForResource() with the
 * account as reader. A read by a former key never gets here: RedirectFormerItemKey moves it to the current one; a change by a former key
 * acts on the item without a redirect.
 */
final class WorkItemsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListWorkItems::run(Actor::fromRequest($request), $request->query()), WorkItemResource::class);
    }

    /** `?include=children,type,workflow` (comma-separated) embeds those as well. */
    public function show(Request $request, WorkItem $item): WorkItemResource
    {
        $include = $request->query('include');

        return new WorkItemResource(GetWorkItem::run(Actor::fromRequest($request), $item, is_string($include) ? explode(',', $include) : (array) $include));
    }

    /** 201: the new item was just created. */
    public function store(Request $request): WorkItemResource
    {
        $actor = Actor::fromRequest($request);
        $item = CreateWorkItem::run($actor, $request->all());
        WorkItem::loadForResource($item, $actor->user);

        return new WorkItemResource($item);
    }

    /** Changes what the body sends; `base_description_version` guards the description (409 `description_conflict`). */
    public function update(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(UpdateWorkItem::run(Actor::fromRequest($request), $item, $request->all()));
    }
}
