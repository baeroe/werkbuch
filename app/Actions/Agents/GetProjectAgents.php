<?php

namespace App\Actions\Agents;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\AgentProjectSettings;
use App\Models\Project;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The agent settings of a project (spec 10.3): whoever sees the project reads them; the defaults without a row.
 */
final class GetProjectAgents
{
    use AsAction;

    /**
     * @throws Problem 404
     */
    public function handle(Actor $actor, Project|string $project): AgentProjectSettings
    {
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;
        Authorize::check($actor, 'view', $project);

        return AgentProjectSettings::of($project->id)->setRelation('project', $project);
    }
}
