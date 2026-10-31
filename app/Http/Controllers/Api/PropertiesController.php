<?php

namespace App\Http\Controllers\Api;

use App\Actions\Properties\DeleteProperty;
use App\Actions\Properties\ListProperties;
use App\Actions\Properties\SaveProperty;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\PropertyResource;
use App\Models\Property;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The properties of the organization. `{property}` is bound by ULID; saving replaces a property as a whole (`PUT`).
 */
final class PropertiesController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListProperties::run(Actor::fromRequest($request), $request->query()), PropertyResource::class);
    }

    /** 201: the new property was just created. */
    public function store(Request $request): PropertyResource
    {
        return new PropertyResource(SaveProperty::run(Actor::fromRequest($request), null, $request->all()));
    }

    public function update(Request $request, Property $property): PropertyResource
    {
        return new PropertyResource(SaveProperty::run(Actor::fromRequest($request), $property, $request->all()));
    }

    /** 200 with the number of items that had a value (without `data`). */
    public function destroy(Request $request, Property $property): JsonResponse
    {
        return response()->json(['affected_items' => DeleteProperty::run(Actor::fromRequest($request), $property)]);
    }
}
