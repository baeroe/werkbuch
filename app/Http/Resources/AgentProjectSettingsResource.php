<?php

namespace App\Http\Resources;

use App\Models\AgentProjectSettings;
use App\Models\Project;
use App\Models\Workflow;
use App\Support\ProjectAgentBots;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The agent settings of a project (spec 10.3), with whether the workflow of the project names every step of the agents
 * (spec 7.4: without them no run starts in the project) and the bots that could review there with their agent (A621).
 * The resource reads the workflow of its project and those bots.
 */
final class AgentProjectSettingsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var AgentProjectSettings $settings */
        $settings = $this->resource;
        /** @var Project $project */
        $project = $settings->getRelation('project');

        return [
            'project_id' => $settings->project_id,
            'review_bot_id' => $settings->review_bot_id,
            'instructions' => $settings->instructions,
            'models' => (object) $settings->models,
            'max_corrections' => $settings->max_corrections,
            'max_conflicts' => $settings->max_conflicts,
            'review_person_prs' => $settings->review_person_prs,
            'comment_on_pr' => $settings->comment_on_pr,
            'merge_method' => $settings->merge_method,
            'setup_command' => $settings->setup_command,
            'teardown_command' => $settings->teardown_command,
            'bots' => ProjectAgentBots::of($project, $settings->review_bot_id),
            'steps_complete' => Workflow::query()->find($project->workflow_id)?->agentStepsComplete() ?? false,
            'updated_at' => $settings->updated_at?->toJSON(),
        ];
    }
}
