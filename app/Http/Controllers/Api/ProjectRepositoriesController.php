<?php

namespace App\Http\Controllers\Api;

use App\Actions\GitHub\ConfirmMergeGuard;
use App\Actions\GitHub\GetProjectRepository;
use App\Actions\GitHub\LinkRepository;
use App\Http\Api\Answer;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\ProjectRepositoryResource;
use App\Models\Project;
use App\OpenApi\GitHubSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The repo of a project (spec 10.3) and the guard against an unauthorized merge (spec 11.3). `{project}` is a ULID, an
 * identifier or a former one.
 */
final class ProjectRepositoriesController extends Controller
{
    /**
     * Read the repo of a project.
     *
     * `data` is `null` for a project without a repo.
     */
    #[Answer(200, GitHubSchemas::class, 'repositoryAnswer', 'The repo of the project, or none.')]
    public function show(Request $request, Project $project): JsonResponse
    {
        $link = GetProjectRepository::run(Actor::fromRequest($request), $project);

        return response()->json(['data' => $link === null ? null : (new ProjectRepositoryResource($link))->resolve($request)]);
    }

    /**
     * Set the repo of a project.
     *
     * One of the repos the app reaches, at most one project per repo; `repository_id` `null` takes the repo away.
     */
    #[Body(GitHubSchemas::class, 'repositoryBody')]
    #[Answer(200, GitHubSchemas::class, 'repositoryAnswer', 'The repo of the project, or none.')]
    public function update(Request $request, Project $project): JsonResponse
    {
        $link = LinkRepository::run(Actor::fromRequest($request), $project, $request->all());

        return response()->json(['data' => $link === null ? null : (new ProjectRepositoryResource($link))->resolve($request)]);
    }

    /**
     * Confirm an unauthorized merge.
     *
     * The guard goes, the strands it paused are open again and runs of the project may start.
     */
    #[Answer(200, GitHubSchemas::class, 'repositoryAnswer', 'The repo of the project without the guard.')]
    public function confirmGuard(Request $request, Project $project): JsonResponse
    {
        return response()->json(['data' => (new ProjectRepositoryResource(ConfirmMergeGuard::run(Actor::fromRequest($request), $project)))->resolve($request)]);
    }
}
