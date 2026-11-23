<?php

namespace App\Actions\AgentRuns;

use App\Access\Authorize;
use App\Domain\Agents\RunStatus;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Cancels a run (spec 6.4, item page or runner page): a run that still waits ends as `canceled` at once; one on a runner
 * becomes `canceling`, its next heartbeat tells the runner, which stops the CLI and reports `canceled` (the reaper ends
 * it when the runner went quiet). A run being canceled stays so (nothing recorded); one that ended is 409 `run_finished`.
 * `agent_run.canceled` names who canceled it.
 */
final class CancelRun
{
    use AsAction;

    /**
     * @throws Problem 404, 403, 409 `run_finished`
     */
    public function handle(Actor $actor, AgentRun $run): AgentRun
    {
        Authorize::check($actor, 'steer', $run);

        return DB::transaction(function () use ($actor, $run): AgentRun {
            $locked = AgentRun::query()->lockForUpdate()->find($run->id) ?? throw Problem::notFound();

            if ($locked->status->finished()) {
                throw Problem::conflict('run_finished');
            }

            if ($locked->status === RunStatus::Canceling) {
                return $locked;
            }

            $old = $locked->status;
            if ($old->pending()) {
                $locked->forceFill(['status' => RunStatus::Canceled, 'waiting_reason' => null, 'finished_at' => now(), 'canceled_by' => $actor->user->id])->save();
            } else {
                $locked->forceFill(['status' => RunStatus::Canceling, 'canceled_by' => $actor->user->id])->save();
            }

            EventRecorder::record(EventType::AgentRunCanceled, $actor, $locked, $locked->project, [
                'status' => ['old' => $old->value, 'new' => $locked->status->value],
            ], ['item_id' => $locked->work_item_id]);

            return $locked;
        }, 3);
    }
}
