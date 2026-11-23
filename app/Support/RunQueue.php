<?php

namespace App\Support;

use App\Domain\Agents\RunType;
use App\Models\AgentConfig;
use App\Models\AgentRun;
use App\Models\Runner;
use Illuminate\Support\Collection;

/**
 * The rules of who may take a waiting run (spec 8.8, 9): the runners of the agent's pool (empty: every runner, A485), only
 * one that reports the run's CLI installed and signed in, and for a run at a strand (but a review) the strand's runner
 * until it has been offline for the fixed grace. `waitingReason` says why a run cannot start anywhere right now (A486).
 */
final class RunQueue
{
    /** Whether the runner may take the run as far as pool, CLI and strand go (the places are the claim's). */
    public static function eligible(AgentRun $run, ?AgentConfig $config, Runner $runner): bool
    {
        if ($config === null || ! $config->enabled || ! $config->pools($runner) || ! $runner->hasCli($run->cli)) {
            return false;
        }

        return self::boundTo($run) === null || self::boundTo($run)?->id === $runner->id;
    }

    /**
     * The runner a run has to wait for: the runner of its strand while it is not gone (spec 9); none for a review, a run
     * without a strand or a strand without a runner.
     */
    public static function boundTo(AgentRun $run): ?Runner
    {
        $runner = $run->type === RunType::Review ? null : $run->thread?->runner;

        return $runner !== null && ! $runner->isGone() ? $runner : null;
    }

    /**
     * Why a run cannot start now: no runner of the pool has its CLI (`no_cli`), or the runner of its strand is offline
     * (`runner_offline`); null when a runner could take it.
     *
     * @param  Collection<int, Runner>  $runners  every runner that is not revoked
     */
    public static function waitingReason(AgentRun $run, ?AgentConfig $config, Collection $runners): ?string
    {
        $pool = $runners->filter(fn (Runner $runner) => $config === null || $config->pools($runner));

        if (! $pool->contains(fn (Runner $runner) => $runner->hasCli($run->cli))) {
            return 'no_cli';
        }

        $bound = self::boundTo($run);

        return $bound !== null && ! $bound->isOnline() ? 'runner_offline' : null;
    }
}
