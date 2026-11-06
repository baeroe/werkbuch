<?php

namespace App\Http\Controllers\Api;

use App\Actions\Labels\DeleteLabel;
use App\Actions\Labels\GetLabel;
use App\Actions\Labels\ListLabels;
use App\Actions\Labels\SaveLabel;
use App\Http\Api\Answer;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\LabelResource;
use App\Models\Label;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The labels of the organization. `{label}` is bound by ULID; saving replaces a label as a whole (`PUT`).
 */
final class LabelsController extends Controller
{
    #[ListOf(ListLabels::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListLabels::run(Actor::fromRequest($request), $request->query()), LabelResource::class);
    }

    public function show(Request $request, Label $label): LabelResource
    {
        return new LabelResource(GetLabel::run(Actor::fromRequest($request), $label));
    }

    /**
     * Create a label (org admins).
     */
    #[Body(CatalogSchemas::class, 'label')]
    public function store(Request $request): JsonResponse
    {
        return (new LabelResource(SaveLabel::run(Actor::fromRequest($request), null, $request->all())))->response()->setStatusCode(201);
    }

    /**
     * Replace a label as a whole (org admins).
     */
    #[Body(CatalogSchemas::class, 'label')]
    public function update(Request $request, Label $label): LabelResource
    {
        return new LabelResource(SaveLabel::run(Actor::fromRequest($request), $label, $request->all()));
    }

    /**
     * Delete a label; it goes from the items that carried it.
     */
    #[Answer(200, CatalogSchemas::class, 'affectedItems', 'How many items had the label.')]
    public function destroy(Request $request, Label $label): JsonResponse
    {
        return response()->json(['affected_items' => DeleteLabel::run(Actor::fromRequest($request), $label)]);
    }
}
