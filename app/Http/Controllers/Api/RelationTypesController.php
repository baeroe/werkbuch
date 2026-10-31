<?php

namespace App\Http\Controllers\Api;

use App\Actions\RelationTypes\DeleteRelationType;
use App\Actions\RelationTypes\ListRelationTypes;
use App\Actions\RelationTypes\SaveRelationType;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\RelationTypeResource;
use App\Models\RelationType;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The relation types of the organization. `{relationType}` is bound by ULID; saving replaces a type as a whole (`PUT`).
 */
final class RelationTypesController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListRelationTypes::run(Actor::fromRequest($request), $request->query()), RelationTypeResource::class);
    }

    /** 201: the new relation type was just created. */
    public function store(Request $request): RelationTypeResource
    {
        return new RelationTypeResource(SaveRelationType::run(Actor::fromRequest($request), null, $request->all()));
    }

    public function update(Request $request, RelationType $relationType): RelationTypeResource
    {
        return new RelationTypeResource(SaveRelationType::run(Actor::fromRequest($request), $relationType, $request->all()));
    }

    /** 200 with the number of relations that went with the type (without `data`). */
    public function destroy(Request $request, RelationType $relationType): JsonResponse
    {
        return response()->json(['affected_relations' => DeleteRelationType::run(Actor::fromRequest($request), $relationType)]);
    }
}
