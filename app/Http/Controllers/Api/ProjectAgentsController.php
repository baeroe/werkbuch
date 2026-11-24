<?php

namespace App\Http\Controllers\Api;

use App\Actions\Agents\GetProjectAgents;
use App\Actions\Agents\SaveProjectAgents;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\AgentProjectSettingsResource;
use App\Models\Project;
use App\OpenApi\AgentSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class ProjectAgentsController extends Controller
{
    /**
     * Read the agent settings of a project.
     *
     * The review agent, the text for agents, the models per kind of run, the brakes and the switches; the defaults
     * while none are set. Whoever sees the project reads them.
     */
    public function show(Request $request, Project $project): AgentProjectSettingsResource
    {
        return new AgentProjectSettingsResource(GetProjectAgents::run(Actor::fromRequest($request), $project));
    }

    /**
     * Set the agent settings of a project.
     *
     * As a whole; the admins of the project.
     */
    #[Body(AgentSchemas::class, 'projectAgents')]
    public function update(Request $request, Project $project): JsonResponse
    {
        return (new AgentProjectSettingsResource(SaveProjectAgents::run(Actor::fromRequest($request), $project, $request->all())))->response()->setStatusCode(200);
    }
}
