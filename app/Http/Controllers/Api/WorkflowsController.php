<?php

namespace App\Http\Controllers\Api;

use App\Actions\Workflows\DeleteWorkflow;
use App\Actions\Workflows\ListWorkflows;
use App\Actions\Workflows\SaveWorkflow;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\WorkflowResource;
use App\Models\Workflow;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The workflows of the organization. `{workflow}` is bound by ULID; saving replaces a workflow as a whole (`PUT`).
 */
final class WorkflowsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListWorkflows::run(Actor::fromRequest($request), $request->query()), WorkflowResource::class);
    }

    /** 201: the new workflow was just created. */
    public function store(Request $request): WorkflowResource
    {
        return new WorkflowResource(SaveWorkflow::run(Actor::fromRequest($request), null, $request->all()));
    }

    public function update(Request $request, Workflow $workflow): WorkflowResource
    {
        return new WorkflowResource(SaveWorkflow::run(Actor::fromRequest($request), $workflow, $request->all()));
    }

    public function destroy(Request $request, Workflow $workflow): Response
    {
        DeleteWorkflow::run(Actor::fromRequest($request), $workflow);

        return response()->noContent();
    }
}
