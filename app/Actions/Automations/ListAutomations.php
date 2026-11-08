<?php

namespace App\Actions\Automations;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Automation;
use App\Models\Project;
use App\Support\Actor;
use App\Support\ProjectAutomations;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The five automations of a project (`GET /api/v1/projects/{project}/automations`, A346) for whoever sees it, archived
 * projects too: always five, in the order of AutomationKey::cases(), a key without a row as the key starts (AutomationKey::enabledByDefault(), no id).
 * One query, however many are stored. The project comes as a model or as a reference (ULID, identifier or a former one).
 */
final class ListAutomations
{
    use AsAction;

    /**
     * @return list<Automation>
     *
     * @throws Problem 404 when the account does not see the project
     */
    public function handle(Actor $actor, Project|string $project): array
    {
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;
        Authorize::check($actor, 'view', $project);

        return array_values(ProjectAutomations::of($project->id));
    }
}
