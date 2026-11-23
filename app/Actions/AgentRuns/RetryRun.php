<?php

namespace App\Actions\AgentRuns;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Starts a run again (spec 7.2 „Erneut starten“): a run that ended without success queues a new one of the same kind,
 * agent, project, item, strand and commit; the brakes of the strand stay as they are (the flow counts them). A run that
 * succeeded or has not ended is 409 `run_not_retryable`; a bot that is no agent any more 409 `agent_off`.
 */
final class RetryRun
{
    use AsAction;

    /**
     * @throws Problem 404, 403, 409 `run_not_retryable` or `agent_off`
     */
    public function handle(Actor $actor, AgentRun $run): AgentRun
    {
        Authorize::check($actor, 'steer', $run);

        return DB::transaction(function () use ($actor, $run): AgentRun {
            $locked = AgentRun::query()->lockForUpdate()->find($run->id) ?? throw Problem::notFound();

            if (! $locked->status->retryable()) {
                throw Problem::conflict('run_not_retryable');
            }

            return EnqueueRun::run($actor, $locked->bot, $locked->project, $locked->workItem, $locked->type->value, $locked->thread, [
                ...$locked->context,
                'head_sha' => $locked->head_sha,
                'trigger_event_id' => $locked->trigger_event_id,
                'retry_of' => $locked->id,
            ]);
        }, 3);
    }
}
