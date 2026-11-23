<?php

namespace App\Support;

use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\Runner;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The run a runner reports on (heartbeat, events, result, spec 6.4), read `for update` in the caller's transaction: a
 * run that is not its own, no longer busy or of another attempt (lost and queued again, taken by another runner) is a
 * 409 `run_replaced`; the runner stops it (Review Focus: an attempt that was replaced never writes).
 */
final class RunAttempts
{
    /**
     * @throws ValidationException without an attempt
     * @throws Problem 404 for an unknown run, 409 `run_replaced`
     */
    public static function lock(Runner $runner, string $runId, mixed $attempt): AgentRun
    {
        if (! is_int($attempt) || $attempt < 1) {
            throw ValidationException::withMessages(['attempt' => __('field.attempt.required')]);
        }

        $run = Str::isUlid(strtolower($runId)) ? AgentRun::query()->lockForUpdate()->find(strtolower($runId)) : null;

        if ($run === null) {
            throw Problem::notFound();
        }

        if ($run->runner_id !== $runner->id || ! $run->status->busy() || $run->attempt !== $attempt) {
            throw Problem::conflict('run_replaced');
        }

        return $run;
    }
}
