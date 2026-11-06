<?php

namespace App\Http\Controllers\Api;

use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\ListRelations;
use App\Actions\WorkItems\RemoveRelation;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\RelationEntryResource;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\OpenApi\WorkItemSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * The relations of work items. `{item}` is bound by ULID or key, `{relation}` by ULID (routes/api.php); whether the
 * account sees them, the actions decide. Every entry is the reader's: an end they do not see is hidden
 * (RelationEntryResource).
 */
final class RelationsController extends Controller
{
    /**
     * List the relations of a work item.
     *
     * `{data: RelationEntry[]}`, without a page: by type, then by the key of the other end, hidden ends last.
     */
    public function index(Request $request, WorkItem $item): AnonymousResourceCollection
    {
        return RelationEntryResource::collection(ListRelations::run(Actor::fromRequest($request), $item));
    }

    /**
     * Relate a work item to another one.
     *
     * `type_id` and `target_id` (ULID or key): 201 `{data: RelationEntry}` as the item reads it (`outward`).
     */
    #[Body(WorkItemSchemas::class, 'relation')]
    public function store(Request $request, WorkItem $item): JsonResponse
    {
        $actor = Actor::fromRequest($request);
        $relation = AddRelation::run($actor, $item, $request->all());

        return (new RelationEntryResource(ListRelations::entry($relation, $item, $actor->user)))->response()->setStatusCode(201);
    }

    /**
     * Remove a relation.
     *
     * From either end the account may change, also when the other end is hidden to it.
     */
    public function destroy(Request $request, WorkItemRelation $relation): Response
    {
        RemoveRelation::run(Actor::fromRequest($request), $relation);

        return response()->noContent();
    }
}
