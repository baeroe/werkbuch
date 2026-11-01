<?php

namespace App\Http\Controllers\Api;

use App\Actions\WorkItems\ArchiveWorkItem;
use App\Actions\WorkItems\BulkUpdateWorkItems;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\GetWorkItem;
use App\Actions\WorkItems\ListWorkItems;
use App\Actions\WorkItems\QueryWorkItems;
use App\Actions\WorkItems\RestoreWorkItem;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\WorkItemResource;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

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

    /** A read through a body (P15): a view, a filter, the short form, a sort; the same page format as the list. */
    public function query(Request $request): JsonResponse
    {
        return ApiList::respond(QueryWorkItems::run(Actor::fromRequest($request), $request->all()), WorkItemResource::class);
    }

    /** 201: the new item was just created. */
    public function store(Request $request): WorkItemResource
    {
        $actor = Actor::fromRequest($request);
        $item = CreateWorkItem::run($actor, $request->all());
        WorkItem::loadForResource($item, $actor->user);

        return new WorkItemResource($item);
    }

    /** `ids` and one `patch` for all of them: 200 `{updated, rejected}` without `data`, a refused item is a line of it. */
    public function bulk(Request $request): JsonResponse
    {
        return response()->json(BulkUpdateWorkItems::run(Actor::fromRequest($request), $request->all()));
    }

    /** Changes what the body sends; `base_description_version` guards the description (409 `description_conflict`). */
    public function update(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(UpdateWorkItem::run(Actor::fromRequest($request), $item, $request->all()));
    }

    /** `to_state_id` and, for a closed state, `resolution_id`: 409 `transition_not_allowed` when the workflow forbids it. */
    public function transition(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(TransitionWorkItem::run(Actor::fromRequest($request), $item, $request->all()));
    }

    /** `type_id` and the `values` the new type asks for. */
    public function changeType(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(ChangeWorkItemType::run(Actor::fromRequest($request), $item, $request->all()));
    }

    /** Only a closed item (409 `not_closed`). */
    public function archive(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(ArchiveWorkItem::run(Actor::fromRequest($request), $item));
    }

    /** Only an archived item (409 `not_archived`). */
    public function restore(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(RestoreWorkItem::run(Actor::fromRequest($request), $item));
    }

    /** 204: the item is gone, its children have no parent any more. */
    public function destroy(Request $request, WorkItem $item): Response
    {
        DeleteWorkItem::run(Actor::fromRequest($request), $item);

        return response()->noContent();
    }
}
