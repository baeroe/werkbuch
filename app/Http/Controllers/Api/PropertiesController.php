<?php

namespace App\Http\Controllers\Api;

use App\Actions\Properties\DeleteProperty;
use App\Actions\Properties\GetProperty;
use App\Actions\Properties\ListProperties;
use App\Actions\Properties\SaveProperty;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\PropertyResource;
use App\Models\Property;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The properties of the organization. `{property}` is bound by ULID; saving replaces a property as a whole (`PUT`).
 */
final class PropertiesController extends Controller
{
    #[ListOf(ListProperties::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListProperties::run(Actor::fromRequest($request), $request->query()), PropertyResource::class);
    }

    public function show(Request $request, Property $property): PropertyResource
    {
        return new PropertyResource(GetProperty::run(Actor::fromRequest($request), $property));
    }

    /**
     * Create a property (org admins).
     */
    #[Body(CatalogSchemas::class, 'property')]
    public function store(Request $request): JsonResponse
    {
        return (new PropertyResource(SaveProperty::run(Actor::fromRequest($request), null, $request->all())))->response()->setStatusCode(201);
    }

    /**
     * Replace a property as a whole (org admins).
     */
    #[Body(CatalogSchemas::class, 'property')]
    public function update(Request $request, Property $property): PropertyResource
    {
        return new PropertyResource(SaveProperty::run(Actor::fromRequest($request), $property, $request->all()));
    }

    /**
     * Delete a property; its values go from the items (the history keeps them).
     */
    #[Answer(200, CatalogSchemas::class, 'affectedItems', 'How many items had a value.')]
    public function destroy(Request $request, Property $property): JsonResponse
    {
        return response()->json(['affected_items' => DeleteProperty::run(Actor::fromRequest($request), $property)]);
    }
}
