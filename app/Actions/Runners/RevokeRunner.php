<?php

namespace App\Actions\Runners;

use App\Access\Authorize;
use App\Actions\AgentRuns\FinishRun;
use App\Domain\Agents\RunStatus;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\Organization;
use App\Models\Runner;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Revokes a runner (spec 6.2, 10.1, org admins, A484): its token stops working at once, what runs on it ends as
 * `canceled` (the runner can no longer report, so werkbuch ends it, like a cancel), and the runs that wait for it go to
 * the rest of the pool (its strands move at once: a revoked runner is gone). The row stays, its runs name it; its name is
 * free again. Answers how many runs it canceled.
 */
final class RevokeRunner
{
    use AsAction;

    /**
     * @throws Problem 403, 404 for a runner revoked already
     */
    public function handle(Actor $actor, Runner $runner): int
    {
        Authorize::check($actor, 'manageRunners', Organization::class);

        return DB::transaction(function () use ($actor, $runner): int {
            $current = Runner::query()->lockForUpdate()->whereNull('revoked_at')->find($runner->id) ?? throw Problem::notFound();
            $current->forceFill(['revoked_at' => now()])->save();

            $runs = AgentRun::query()->lockForUpdate()->where('runner_id', $current->id)
                ->whereIn('status', [RunStatus::Running->value, RunStatus::Canceling->value])->orderBy('id')->get();
            foreach ($runs as $run) {
                FinishRun::end($run, RunStatus::Canceled, ['canceled_by' => $actor->user->id, 'error' => 'runner_revoked']);
            }

            EventRecorder::record(EventType::RunnerRevoked, $actor, $current, null, null, ['name' => $current->name, 'canceled' => $runs->count()]);

            return $runs->count();
        }, 3);
    }
}
