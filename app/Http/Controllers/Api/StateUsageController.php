<?php

namespace App\Http\Controllers\Api;

use App\Actions\Workflows\ListStateUsage;
use App\Http\Api\Answer;
use App\Http\Controllers\Controller;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use Dedoc\Scramble\Attributes\QueryParameter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * How many items stand in each state, of a project (`?project=WEB`) or of the projects of a workflow the account sees
 * (`?workflow=<id>`), for the mapping of states. Whether the account sees the project, the action decides.
 */
final class StateUsageController extends Controller
{
    /**
     * The items per state of a project or of the projects of a workflow.
     *
     * `{data: [{state_id, items}]}`, states without items left out; archived items count.
     */
    #[Answer(200, CatalogSchemas::class, 'stateUsage', 'The items per state.')]
    #[QueryParameter('project', 'A project (ULID, identifier or former identifier). Either `project` or `workflow`.', required: false, type: 'string')]
    #[QueryParameter('workflow', 'A workflow (ULID): counts in the projects of the workflow that the account sees. Either `project` or `workflow`.', required: false, type: 'string')]
    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => ListStateUsage::run(Actor::fromRequest($request), $request->only(['project', 'workflow']))]);
    }
}
