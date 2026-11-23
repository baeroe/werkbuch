<?php

namespace App\Actions\AgentRuns;

use App\Domain\Agents\Protocol;
use App\Domain\Agents\RunStatus;
use App\Exceptions\Problem;
use App\Models\Runner;
use App\Support\Actor;
use App\Support\RunAttempts;
use App\Support\RunnerProtocol;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The heartbeat of a running run (spec 6.4): it extends the lease and keeps the report of the runner; the answer says
 * whether the run was canceled (the runner then stops the CLI and reports `canceled`), when the lease ends and when the
 * time limit does. The report is kept before the run is locked (Review Focus: a revocation holds runner, then runs).
 */
final class RecordHeartbeat
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `attempt`, the report, `version` and `protocol` of the headers
     * @return array<string, mixed>
     *
     * @throws ValidationException
     * @throws Problem 404, 409 `run_replaced`
     */
    public function handle(Actor $actor, Runner $runner, string $runId, array $input): array
    {
        $report = RunnerProtocol::report($input);
        RunnerProtocol::keep($runner, $report, RunnerProtocol::version($input['version'] ?? null), RunnerProtocol::protocol($input['protocol'] ?? null));

        return DB::transaction(function () use ($runner, $runId, $input): array {
            $run = RunAttempts::lock($runner, $runId, $input['attempt'] ?? null);
            $run->forceFill(['lease_expires_at' => now()->addSeconds(Protocol::LEASE_SECONDS)])->save();

            return [
                'cancel' => $run->status === RunStatus::Canceling,
                'lease_expires_at' => $run->lease_expires_at?->toJSON(),
                'deadline_at' => $run->deadline()?->toJSON(),
                ...RunnerProtocol::answer($runner),
            ];
        }, 3);
    }
}
