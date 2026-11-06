<?php

namespace App\Http\Controllers\Api;

use App\Actions\Workflows\DeleteWorkflow;
use App\Actions\Workflows\GetWorkflow;
use App\Actions\Workflows\ListWorkflows;
use App\Actions\Workflows\SaveWorkflow;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\WorkflowResource;
use App\Models\Workflow;
use App\OpenApi\CatalogSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The workflows of the organization. `{workflow}` is bound by ULID; saving replaces a workflow as a whole (`PUT`).
 */
final class WorkflowsController extends Controller
{
    /**
     * List the workflows with their states and transitions.
     */
    #[ListOf(ListWorkflows::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListWorkflows::run(Actor::fromRequest($request), $request->query()), WorkflowResource::class);
    }

    /**
     * Read a workflow.
     */
    public function show(Request $request, Workflow $workflow): WorkflowResource
    {
        return new WorkflowResource(GetWorkflow::run(Actor::fromRequest($request), $workflow));
    }

    /**
     * Create a workflow (org admins).
     */
    #[Body(CatalogSchemas::class, 'workflow')]
    public function store(Request $request): JsonResponse
    {
        return (new WorkflowResource(SaveWorkflow::run(Actor::fromRequest($request), null, $request->all())))->response()->setStatusCode(201);
    }

    /**
     * Replace a workflow as a whole (org admins).
     */
    #[Body(CatalogSchemas::class, 'workflow')]
    public function update(Request $request, Workflow $workflow): WorkflowResource
    {
        return new WorkflowResource(SaveWorkflow::run(Actor::fromRequest($request), $workflow, $request->all()));
    }

    /**
     * Delete a workflow. The default workflow (409 `default_workflow`) and one that projects use (409 `in_use`, `projects` names them) stay.
     */
    public function destroy(Request $request, Workflow $workflow): Response
    {
        DeleteWorkflow::run(Actor::fromRequest($request), $workflow);

        return response()->noContent();
    }
}
