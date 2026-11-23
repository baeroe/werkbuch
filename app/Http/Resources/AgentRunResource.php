<?php

namespace App\Http\Resources;

use App\Models\AgentRun;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A run of an agent (spec 7.5, 10.6) as `AgentRun` of the clickdummy: kind, status and why it waits, the agent with
 * CLI, model and where the model came from, the runner (its name and whether it is online, the runner is loaded with
 * it), project, item, strand, attempt, the times and what came of it. Never its token or session.
 *
 * @mixin AgentRun
 */
final class AgentRunResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var AgentRun $run */
        $run = $this->resource;

        return [
            'id' => $run->id,
            'type' => $run->type->value,
            'status' => $run->status->value,
            'waiting_reason' => $run->waiting_reason,
            'bot_id' => $run->bot_id,
            'cli' => $run->cli->value,
            'model' => $run->model,
            'model_source' => $run->model_source,
            'model_label_id' => $run->model_label_id,
            'runner_id' => $run->runner_id,
            'runner_name' => $run->runner?->name,
            'runner_online' => $run->runner?->isOnline() ?? false,
            'project_id' => $run->project_id,
            'work_item_id' => $run->work_item_id,
            'thread_id' => $run->thread_id,
            'head_sha' => $run->head_sha,
            'attempt' => $run->attempt,
            'lease_expires_at' => $run->lease_expires_at?->toJSON(),
            'started_at' => $run->started_at?->toJSON(),
            'deadline_at' => $run->deadline()?->toJSON(),
            'finished_at' => $run->finished_at?->toJSON(),
            'result' => $run->result,
            'usage' => $run->usage,
            'error' => $run->error,
            'canceled_by' => $run->canceled_by,
            'events_dropped' => $run->events_dropped,
            'created_at' => $run->created_at?->toJSON(),
            'updated_at' => $run->updated_at?->toJSON(),
        ];
    }
}
