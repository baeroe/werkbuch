<?php

namespace App\Http\Controllers\Api;

use App\Actions\RelationTypes\DeleteRelationType;
use App\Actions\RelationTypes\GetRelationType;
use App\Actions\RelationTypes\ListRelationTypes;
use App\Actions\RelationTypes\SaveRelationType;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\RelationTypeResource;
use App\Models\RelationType;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The relation types of the organization. `{relationType}` is bound by ULID; saving replaces a type as a whole (`PUT`).
 */
final class RelationTypesController extends Controller
{
    #[ListOf(ListRelationTypes::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListRelationTypes::run(Actor::fromRequest($request), $request->query()), RelationTypeResource::class);
    }

    public function show(Request $request, RelationType $relationType): RelationTypeResource
    {
        return new RelationTypeResource(GetRelationType::run(Actor::fromRequest($request), $relationType));
    }

    /**
     * Create a relation type (org admins).
     */
    #[Body(CatalogSchemas::class, 'relationType')]
    public function store(Request $request): JsonResponse
    {
        return (new RelationTypeResource(SaveRelationType::run(Actor::fromRequest($request), null, $request->all())))->response()->setStatusCode(201);
    }

    /**
     * Replace a relation type as a whole (org admins).
     */
    #[Body(CatalogSchemas::class, 'relationType')]
    public function update(Request $request, RelationType $relationType): RelationTypeResource
    {
        return new RelationTypeResource(SaveRelationType::run(Actor::fromRequest($request), $relationType, $request->all()));
    }

    /**
     * Delete a relation type; its relations go with it. A built-in type is 409 `built_in`.
     */
    #[Answer(200, CatalogSchemas::class, 'affectedRelations', 'How many relations went with the type.')]
    public function destroy(Request $request, RelationType $relationType): JsonResponse
    {
        return response()->json(['affected_relations' => DeleteRelationType::run(Actor::fromRequest($request), $relationType)]);
    }
}
