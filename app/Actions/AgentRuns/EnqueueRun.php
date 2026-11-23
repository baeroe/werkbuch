<?php

namespace App\Actions\AgentRuns;

use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentConfig;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\Runner;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\RunQueue;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Queues a run of an agent (spec 7.5): of a project always, of an item mostly (a review of a PR without one has none),
 * at a strand when the flow names one. The model comes from the agent (spec 7.7: its model for the kind, else its
 * default; the model label of the item and the project come with the flow, A479). A run that no runner of the pool can
 * take with its CLI waits (`waiting`, `no_cli`) and starts once one reports it. The callers decide that a run is due
 * (the flow, starting a run again); this action checks no rights.
 */
final class EnqueueRun
{
    use AsAction;

    /** What `context` may name besides what the flow keeps for the prompt. */
    public const COLUMNS = ['head_sha', 'trigger_event_id'];

    /**
     * @param  array<string, mixed>  $context  `head_sha` (a review), `trigger_event_id`, and what the flow keeps for the prompt
     *
     * @throws Problem 409 `agent_off` for a bot that is no agent (any more)
     */
    public function handle(Actor $actor, User $bot, Project $project, ?WorkItem $item, string $type, ?AgentThread $thread, array $context = []): AgentRun
    {
        $kind = RunType::tryFrom($type) ?? throw new InvalidArgumentException("Unknown kind of run [{$type}].");

        if ($item !== null && $item->project_id !== $project->id) {
            throw new InvalidArgumentException('The item of a run belongs to its project.');
        }

        return DB::transaction(function () use ($actor, $bot, $project, $item, $kind, $thread, $context): AgentRun {
            $config = AgentConfig::query()->where('bot_id', $bot->id)->first();
            if ($config === null || ! $config->enabled) {
                throw Problem::conflict('agent_off');
            }

            $own = $config->models[$kind->value] ?? null;
            $headSha = $context['head_sha'] ?? null;
            $trigger = $context['trigger_event_id'] ?? null;

            $run = AgentRun::query()->create([
                'type' => $kind,
                'status' => RunStatus::Queued,
                'bot_id' => $bot->id,
                'cli' => $config->cli,
                'model' => $own ?? $config->model,
                'model_source' => $own === null ? 'default' : 'bot',
                'project_id' => $project->id,
                'work_item_id' => $item?->id,
                'thread_id' => $thread?->id,
                'head_sha' => is_string($headSha) ? $headSha : null,
                'trigger_event_id' => is_string($trigger) ? $trigger : null,
                'context' => array_diff_key($context, array_flip(self::COLUMNS)),
                'attempt' => 1,
                'events_dropped' => 0,
            ]);

            $reason = RunQueue::waitingReason($run, $config, Runner::query()->whereNull('revoked_at')->get());
            if ($reason !== null) {
                $run->forceFill(['status' => RunStatus::Waiting, 'waiting_reason' => $reason])->save();
            }

            EventRecorder::record(EventType::AgentRunQueued, $actor, $run, $project, [
                'status' => ['old' => null, 'new' => $run->status->value],
            ], ['item_id' => $item?->id, 'type' => $kind->value, 'bot_id' => $bot->id]);

            return $run;
        }, 3);
    }
}
