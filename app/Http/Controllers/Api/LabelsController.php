<?php

namespace App\Http\Controllers\Api;

use App\Actions\Labels\DeleteLabel;
use App\Actions\Labels\ListLabels;
use App\Actions\Labels\SaveLabel;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\LabelResource;
use App\Models\Label;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The labels of the organization. `{label}` is bound by ULID; saving replaces a label as a whole (`PUT`).
 */
final class LabelsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListLabels::run(Actor::fromRequest($request), $request->query()), LabelResource::class);
    }

    /** 201: the new label was just created. */
    public function store(Request $request): LabelResource
    {
        return new LabelResource(SaveLabel::run(Actor::fromRequest($request), null, $request->all()));
    }

    public function update(Request $request, Label $label): LabelResource
    {
        return new LabelResource(SaveLabel::run(Actor::fromRequest($request), $label, $request->all()));
    }

    /** 200 with the number of items that had the label (without `data`). */
    public function destroy(Request $request, Label $label): JsonResponse
    {
        return response()->json(['affected_items' => DeleteLabel::run(Actor::fromRequest($request), $label)]);
    }
}
