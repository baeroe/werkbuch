<?php

namespace App\Http\Controllers\Api;

use App\Actions\Workflows\ListStateUsage;
use App\Http\Controllers\Controller;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * How many items stand in each state, of a project (`?project=WEB`) or of the projects of a workflow the account sees
 * (`?workflow=<id>`), for the mapping of states. Whether the account sees the project, the action decides.
 */
final class StateUsageController extends Controller
{
    /** `{data: [{state_id, items}]}`, states without items left out. */
    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => ListStateUsage::run(Actor::fromRequest($request), $request->only(['project', 'workflow']))]);
    }
}
