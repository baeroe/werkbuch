<?php

namespace App\Http\Controllers\Api;

use App\Actions\Projects\ArchiveProject;
use App\Actions\Projects\AssignWorkflow;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\GetProject;
use App\Actions\Projects\ListProjects;
use App\Actions\Projects\UpdateProject;
use App\Http\Api\ApiList;
use App\Http\Api\Body;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\ProjectResource;
use App\Models\Project;
use App\OpenApi\CatalogSchemas;
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
    /**
     * List the projects the account sees.
     *
     * Ordered by name; archived ones only with `include_archived=1`.
     */
    #[ListOf(ListProjects::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListProjects::run(Actor::fromRequest($request), $request->query()), ProjectResource::class);
    }

    /**
     * Create a project (every account with `project.create`).
     */
    #[Body(CatalogSchemas::class, 'projectCreate')]
    public function store(Request $request): JsonResponse
    {
        return (new ProjectResource(CreateProject::run(Actor::fromRequest($request), $request->all())))->response()->setStatusCode(201);
    }

    /**
     * Read a project.
     *
     * By ULID, identifier or a former identifier; one the account does not see is 404.
     */
    public function show(Request $request, Project $project): ProjectResource
    {
        return new ProjectResource(GetProject::run(Actor::fromRequest($request), $project));
    }

    /**
     * Change a project (its admins); only the keys that are named change.
     */
    #[Body(CatalogSchemas::class, 'projectUpdate')]
    public function update(Request $request, Project $project): ProjectResource
    {
        return new ProjectResource(UpdateProject::run(Actor::fromRequest($request), $project, $request->all()));
    }

    /**
     * Switch the workflow of a project with a mapping of the states (never through `PATCH`, P9).
     */
    #[Body(CatalogSchemas::class, 'projectWorkflow')]
    public function assignWorkflow(Request $request, Project $project): ProjectResource
    {
        return new ProjectResource(AssignWorkflow::run(Actor::fromRequest($request), $project, $request->all()));
    }

    /**
     * Archive a project (`project.archive`).
     *
     * Its items are read-only until it is restored; its admins can still change its settings.
     */
    public function archive(Request $request, Project $project): ProjectResource
    {
        return new ProjectResource(ArchiveProject::run(Actor::fromRequest($request), $project));
    }

    /**
     * Restore an archived project (`project.archive`).
     */
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
