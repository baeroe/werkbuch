<?php

namespace App\Actions\GitHub;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The repo of a project (spec 10.3) with its base branch, the ruleset hint and the guard, or none. Who sees the project
 * reads it.
 */
final class GetProjectRepository
{
    use AsAction;

    /**
     * @throws Problem 404
     */
    public function handle(Actor $actor, Project|string $project): ?ProjectRepository
    {
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;
        Authorize::check($actor, 'view', $project);

        return ProjectRepository::query()->with('repository')->where('project_id', $project->id)->first();
    }
}
