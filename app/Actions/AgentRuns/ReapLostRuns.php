<?php

namespace App\Actions\AgentRuns;

use App\Domain\Agents\Protocol;
use App\Domain\Agents\RunStatus;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\AgentRun;
use App\Support\Actor;
use App\Support\RunQueue;
use App\Support\RunTokens;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The reaper (every minute, spec 6.4, A475, A486). A busy run past its time limit and one more lease without a result
 * is `timed_out`. A busy run whose lease ran out (the machine slept, lost the net, the runner crashed) is lost: the first
 * time it goes back to the queue as a new attempt (the runner of the old one gets 409 `run_replaced`), the second time
 * it ends as `lost`; one being canceled ends as `canceled`. Waiting runs get their reason anew (`RunQueue::refreshReasons`): `agent_off` while the
 * agent is off, `no_cli` while no runner of the pool has the CLI, `runner_offline` while the runner of their strand is
 * offline, none once a runner could take them.
 */
final class ReapLostRuns
{
    use AsAction;

    /** The shortest time limit of a kind, after which a busy run may be past its own. */
    private const SHORTEST_LIMIT = 10;

    /**
     * @return array{timed_out: int, canceled: int, requeued: int, lost: int, waiting: int}
     */
    public function handle(Actor $actor): array
    {
        $counts = ['timed_out' => 0, 'canceled' => 0, 'requeued' => 0, 'lost' => 0, 'waiting' => 0];

        $suspects = AgentRun::query()->whereIn('status', [RunStatus::Running->value, RunStatus::Canceling->value])
            ->where(fn ($query) => $query->where('lease_expires_at', '<', now())->orWhere('started_at', '<', now()->subMinutes(self::SHORTEST_LIMIT)))
            ->pluck('id')->map(fn (mixed $id) => (string) $id);

        foreach ($suspects as $id) {
            $outcome = DB::transaction(function () use ($id): ?string {
                $run = AgentRun::query()->lockForUpdate()->whereKey($id)->first();
                if ($run === null || ! $run->status->busy()) {
                    return null;
                }

                if ($run->pastLimit()) {
                    FinishRun::end($run, RunStatus::TimedOut, ['error' => 'timed_out']);

                    return 'timed_out';
                }

                if ($run->lease_expires_at !== null && $run->lease_expires_at->isFuture()) {
                    return null;
                }

                // a run being canceled whose runner went quiet: nobody needs it any more
                if ($run->status === RunStatus::Canceling) {
                    FinishRun::end($run, RunStatus::Canceled);

                    return 'canceled';
                }

                if ($run->attempt >= Protocol::MAX_ATTEMPTS) {
                    FinishRun::end($run, RunStatus::Lost, ['error' => AgentRun::LOST]);

                    return 'lost';
                }

                self::requeue($run, AgentRun::LOST);

                return 'requeued';
            }, 3);

            if ($outcome !== null) {
                $counts[$outcome]++;
            }
        }

        $counts['waiting'] = RunQueue::refreshReasons();

        return $counts;
    }

    /**
     * Puts a busy run read `for update` back into the queue as a new attempt (the runner of the old one gets 409
     * `run_replaced`), its run token revoked: a lost run (A475) or one GitHub gave no token for (A511); a run GitHub did
     * not answer for keeps its attempt and waits until `waitUntil` (`waiting` with the reason, `retry_at`), and its
     * `agent_run.queued` says `waiting` as the status.
     */
    public static function requeue(AgentRun $run, string $reason, bool $newAttempt = true, ?CarbonInterface $waitUntil = null): void
    {
        $status = $waitUntil === null ? RunStatus::Queued : RunStatus::Waiting;
        $run->forceFill([
            'status' => $status, 'waiting_reason' => $waitUntil === null ? null : $reason, 'retry_at' => $waitUntil,
            'attempt' => $run->attempt + ($newAttempt ? 1 : 0), 'runner_id' => null, 'lease_expires_at' => null, 'started_at' => null, 'error' => $reason,
        ])->save();
        RunTokens::revoke($run);
        EventRecorder::record(EventType::AgentRunQueued, Actor::agent($run->bot)->withReason($reason), $run, $run->project, [
            'status' => ['old' => RunStatus::Running->value, 'new' => $status->value],
        ], ['item_id' => $run->work_item_id, 'type' => $run->type->value, 'attempt' => $run->attempt]);
    }
}
