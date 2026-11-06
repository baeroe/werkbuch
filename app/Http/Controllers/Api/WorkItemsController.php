<?php

namespace App\Http\Controllers\Api;

use App\Actions\WorkItems\ArchiveWorkItem;
use App\Actions\WorkItems\BulkUpdateWorkItems;
use App\Actions\WorkItems\ChangeWorkItemType;
use App\Actions\WorkItems\CountWorkItems;
use App\Actions\WorkItems\CreateWorkItem;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Actions\WorkItems\GetWorkItem;
use App\Actions\WorkItems\GroupWorkItems;
use App\Actions\WorkItems\ListWorkItems;
use App\Actions\WorkItems\QueryWorkItems;
use App\Actions\WorkItems\RestoreWorkItem;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\ItemGroupsResource;
use App\Http\Resources\WorkItemResource;
use App\Models\WorkItem;
use App\OpenApi\ItemQueryDocs;
use App\OpenApi\WorkItemSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use stdClass;

/**
 * The work items. `{item}` is bound by ULID or key (`WEB-12`, any case, also with a former identifier, routes/api.php);
 * whether the account sees the item, the action decides. Every item leaves through WorkItem::loadForResource() with the
 * account as reader. A read by a former key never gets here: RedirectFormerItemKey moves it to the current one; a change by a former key
 * acts on the item without a redirect.
 */
final class WorkItemsController extends Controller
{
    /**
     * List work items.
     *
     * The items the account sees, filtered by a view and the short form `filter[<key>]` (the long form of a filter goes
     * through `POST /work-items/query`). `include` is refused here (a list embeds nothing).
     */
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListWorkItems::run(Actor::fromRequest($request), $request->query()), WorkItemResource::class);
    }

    /**
     * Get a work item.
     *
     * `include` (comma-separated) embeds its children, type, workflow, relations and file list as well.
     */
    public function show(Request $request, WorkItem $item): WorkItemResource
    {
        $include = $request->query('include');

        return new WorkItemResource(GetWorkItem::run(Actor::fromRequest($request), $item, is_string($include) ? explode(',', $include) : (array) $include));
    }

    /**
     * Query work items.
     *
     * A read through a body (P15): a view, a filter, the short form, a sort; the same page format as the list. A list
     * read by `POST` leads on with `meta.next_cursor` as `cursor` in the same body.
     */
    #[Body(ItemQueryDocs::class, 'query')]
    public function query(Request $request): JsonResponse
    {
        return ApiList::respond(QueryWorkItems::run(Actor::fromRequest($request), $request->all()), WorkItemResource::class);
    }

    /**
     * Group work items.
     *
     * The groups of a query body and their numbers: `{data: {group_by, total, groups: [{key, count, item?}]}}`, `item`
     * (`{id, key, title, type_id}`, `null` for `none`) only for parent groups.
     */
    #[Body(ItemQueryDocs::class, 'groups')]
    #[Answer(200, WorkItemSchemas::class, 'groups', 'The groups and their numbers.')]
    public function groups(Request $request): JsonResponse
    {
        return response()->json(['data' => (new ItemGroupsResource(GroupWorkItems::run(Actor::fromRequest($request), $request->all())))->resolve($request)]);
    }

    /**
     * Count work items.
     *
     * The number of items of each named filter: `{data: {<name>: count}}` (an object, also for names like `0`).
     */
    #[Body(ItemQueryDocs::class, 'counts')]
    #[Answer(200, WorkItemSchemas::class, 'counts', 'The number of items per filter.')]
    public function counts(Request $request): JsonResponse
    {
        $input = $request->all();
        // PHP decodes `{"0": …}` into a list; only the raw body tells an object of filters from a list (the values stay
        // those of the input, trimmed like every other body, K17)
        $raw = json_decode($request->getContent());
        if ($raw instanceof stdClass && ($raw->filters ?? null) instanceof stdClass && is_array($input['filters'] ?? null)) {
            $input['filters'] = (object) $input['filters'];
        }

        return response()->json(['data' => (object) CountWorkItems::run(Actor::fromRequest($request), $input)]);
    }

    /**
     * Create a work item.
     */
    #[Body(WorkItemSchemas::class, 'create')]
    public function store(Request $request): JsonResponse
    {
        $actor = Actor::fromRequest($request);
        $item = CreateWorkItem::run($actor, $request->all());
        WorkItem::loadForResource($item, $actor->user);

        return (new WorkItemResource($item))->response()->setStatusCode(201);
    }

    /**
     * Change many work items.
     *
     * `ids` and one `patch` for all of them: 200 `{updated, rejected}` without `data`, a refused item is a line of it.
     */
    #[Body(WorkItemSchemas::class, 'bulk')]
    #[Answer(200, WorkItemSchemas::class, 'bulkDone', 'Which items took the patch and which refused it.')]
    public function bulk(Request $request): JsonResponse
    {
        return response()->json(BulkUpdateWorkItems::run(Actor::fromRequest($request), $request->all()));
    }

    /**
     * Change a work item.
     *
     * Changes what the body sends; `base_description_version` guards the description (409 `description_conflict` with
     * `current`, the item as it is now).
     */
    #[Body(WorkItemSchemas::class, 'update')]
    public function update(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(UpdateWorkItem::run(Actor::fromRequest($request), $item, $request->all()));
    }

    /**
     * Move a work item to another state.
     *
     * `to_state_id` and, for a closed state, `resolution_id`: 409 `transition_not_allowed` when the workflow forbids it.
     */
    #[Body(WorkItemSchemas::class, 'transition')]
    public function transition(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(TransitionWorkItem::run(Actor::fromRequest($request), $item, $request->all()));
    }

    /**
     * Change the type of a work item.
     *
     * `type_id` and the `values` the new type asks for.
     */
    #[Body(WorkItemSchemas::class, 'changeType')]
    public function changeType(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(ChangeWorkItemType::run(Actor::fromRequest($request), $item, $request->all()));
    }

    /**
     * Archive a work item.
     *
     * Only a closed item (409 `not_closed`); an archived item is read-only.
     */
    public function archive(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(ArchiveWorkItem::run(Actor::fromRequest($request), $item));
    }

    /**
     * Restore an archived work item.
     *
     * Only an archived item (409 `not_archived`); its state stays.
     */
    public function restore(Request $request, WorkItem $item): WorkItemResource
    {
        return new WorkItemResource(RestoreWorkItem::run(Actor::fromRequest($request), $item));
    }

    /**
     * Delete a work item.
     *
     * The admins of the project only. The item is gone, its children have no parent any more.
     */
    public function destroy(Request $request, WorkItem $item): Response
    {
        DeleteWorkItem::run(Actor::fromRequest($request), $item);

        return response()->noContent();
    }
}
