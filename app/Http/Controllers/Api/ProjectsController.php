<?php

namespace App\Http\Controllers\Api;

use App\Actions\Projects\ArchiveProject;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\GetProject;
use App\Actions\Projects\ListProjects;
use App\Actions\Projects\UpdateProject;
use App\Http\Api\ApiList;
use App\Http\Controllers\Controller;
use App\Http\Resources\ProjectResource;
use App\Models\Project;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Projects. `{project}` is bound by ULID, identifier or former identifier (routes/api.php); whether the account sees
 * it, the action decides.
 */
final class ProjectsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListProjects::run(Actor::fromRequest($request), $request->query()), ProjectResource::class);
    }

    public function store(Request $request): ProjectResource
    {
        return new ProjectResource(CreateProject::run(Actor::fromRequest($request), $request->all()));
    }

    public function show(Request $request, Project $project): ProjectResource
    {
        return new ProjectResource(GetProject::run(Actor::fromRequest($request), $project));
    }

    public function update(Request $request, Project $project): ProjectResource
    {
        return new ProjectResource(UpdateProject::run(Actor::fromRequest($request), $project, $request->all()));
    }

    public function archive(Request $request, Project $project): ProjectResource
    {
        return new ProjectResource(ArchiveProject::run(Actor::fromRequest($request), $project));
    }

    public function restore(Request $request, Project $project): ProjectResource
    {
        return new ProjectResource(ArchiveProject::run(Actor::fromRequest($request), $project, false));
    }

    /** Accepted: the project is gone for everybody now, its data goes in the background. */
    public function destroy(Request $request, Project $project): Response
    {
        DeleteProject::run(Actor::fromRequest($request), $project);

        return response()->noContent(202);
    }
}
