<?php

namespace App\Support;

use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Models\AgentConfig;
use App\Models\AgentRun;
use App\Models\Runner;
use Illuminate\Support\Collection;

/**
 * The rules of who may take a waiting run (spec 8.8, 9): the runners of the agent's pool (empty: every runner, A485), only
 * one that reports the run's CLI installed and signed in, and for a run at a strand (but a review) the strand's runner
 * until it has been offline for the fixed grace. `waitingReason` says why a run cannot start anywhere right now (A486,
 * A490), `refreshReasons` writes it.
 */
final class RunQueue
{
    /** Whether the runner may take the run as far as pool, CLI and strand go (the places are the claim's). */
    public static function eligible(AgentRun $run, ?AgentConfig $config, Runner $runner): bool
    {
        if ($config === null || ! $config->enabled || ! $config->pools($runner) || ! $runner->hasCli($run->cli)) {
            return false;
        }

        $bound = self::boundTo($run);

        return $bound === null || $bound->id === $runner->id;
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
     * Why a run cannot start now: its agent is off (`agent_off`), no runner of the pool has its CLI (`no_cli`), or the
     * runner of its strand is offline (`runner_offline`); null when a runner could take it.
     *
     * @param  Collection<int, Runner>  $runners  every runner that is not revoked
     */
    public static function waitingReason(AgentRun $run, ?AgentConfig $config, Collection $runners): ?string
    {
        if ($config === null || ! $config->enabled) {
            return 'agent_off';
        }

        $pool = $runners->filter(fn (Runner $runner) => $config->pools($runner));

        if (! $pool->contains(fn (Runner $runner) => $runner->hasCli($run->cli))) {
            return 'no_cli';
        }

        $bound = self::boundTo($run);

        return $bound !== null && ! $bound->isOnline() ? 'runner_offline' : null;
    }

    /**
     * Gives the waiting runs (of one bot, or all) their reason anew: `waiting` with it, `queued` without (A486). Each run
     * is written only if it still waits and its state changes; no event, the reason is bookkeeping. Answers how many wait.
     */
    public static function refreshReasons(?string $botId = null): int
    {
        $pending = AgentRun::query()->whereIn('status', [RunStatus::Queued->value, RunStatus::Waiting->value])
            ->when($botId !== null, fn ($query) => $query->where('bot_id', $botId))
            ->with('thread.runner')->get();
        $runners = Runner::query()->whereNull('revoked_at')->get();
        $configs = AgentConfig::query()->whereIn('bot_id', $pending->pluck('bot_id')->unique()->values())->get()->keyBy('bot_id');
        $waiting = 0;

        foreach ($pending as $run) {
            $reason = self::waitingReason($run, $configs->get($run->bot_id), $runners);
            $status = $reason === null ? RunStatus::Queued : RunStatus::Waiting;
            $waiting += $reason === null ? 0 : 1;

            if ($run->status !== $status || $run->waiting_reason !== $reason) {
                AgentRun::query()->whereKey($run->id)->whereIn('status', [RunStatus::Queued->value, RunStatus::Waiting->value])
                    ->update(['status' => $status->value, 'waiting_reason' => $reason, 'updated_at' => now()]);
            }
        }

        return $waiting;
    }
}
