<?php

namespace App\Live;

use App\Jobs\SendRunLog;
use App\Models\AgentRun;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Tells the item that the log of its run grew (`agent_run.log` on `private-work-item.{id}`, WEBU-28, A641): at most one
 * message a run and PAUSE second. The first batch of a pause is told at once (leading edge); a batch within it queues
 * SendRunLog for the end of the pause (one per run, ShouldBeUnique), so the last lines are never left untold. Only after
 * the commit (DB::afterCommit), only through Broadcasts (never throws). A run without an item tells nobody.
 */
final class RunLog
{
    /** Seconds between two messages of a run. */
    public const PAUSE = 1;

    public static function grew(AgentRun $run): void
    {
        if ($run->work_item_id === null) {
            return;
        }

        $runId = $run->id;
        $itemId = $run->work_item_id;
        $projectId = $run->project_id;
        DB::afterCommit(function () use ($runId, $itemId, $projectId): void {
            if (Cache::add(self::key($runId), true, self::PAUSE)) {
                Broadcasts::send(LiveMessage::runLog($runId, $itemId, $projectId));

                return;
            }

            SendRunLog::dispatch($runId)->delay(now()->addSeconds(self::PAUSE));
        });
    }

    /** The message at the end of a pause (SendRunLog), which starts a pause of its own. */
    public static function send(AgentRun $run): void
    {
        if ($run->work_item_id === null) {
            return;
        }

        Cache::put(self::key($run->id), true, self::PAUSE);
        Broadcasts::send(LiveMessage::runLog($run->id, $run->work_item_id, $run->project_id));
    }

    private static function key(string $runId): string
    {
        return "run-log:{$runId}";
    }
}
