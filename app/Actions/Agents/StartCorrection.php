<?php

namespace App\Actions\Agents;

use App\Actions\AgentRuns\EnqueueRun;
use App\Domain\Agents\Brakes;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Domain\Workflow\AgentStep;
use App\Exceptions\Problem;
use App\Models\AgentProjectSettings;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A correction at a strand (spec 7.1, 7.2): CI red or a review with findings at the PR of the agent, a person setting
 * the item back, a person assigning the bot again (the brakes start again, `$resetBrakes`), or the guard lifted. The
 * item goes to „Korrektur“; the correction continues the session of the strand. Once per head commit of the PR (CI and
 * review of one commit make one correction: findings of a correction that waits still join it). At the brake
 * (spec 7.2: at most so many corrections per strand) the strand pauses instead. Nothing at a strand that ended.
 */
final class StartCorrection
{
    use AsAction;

    /** Where the findings come from: CI, the review, people, a merge GitHub refused, the guard, a run that failed. */
    public const SOURCES = ['ci', 'review', 'comments', 'merge', 'guard', 'failure'];

    /** Why a strand pauses that only the admins open again: the guard against an unauthorized merge, GitHub gone. */
    public const HELD = ['guard', 'github'];

    public function handle(Actor $actor, AgentThread $thread, string $source, string $findings, ?string $headSha = null, bool $resetBrakes = false): ?AgentRun
    {
        return DB::transaction(function () use ($actor, $thread, $source, $findings, $headSha, $resetBrakes): ?AgentRun {
            $item = WorkItem::query()->findOrFail($thread->work_item_id);
            ItemLock::take($item);
            $runs = AgentFlow::openRuns($thread);
            $locked = AgentThread::query()->lockForUpdate()->findOrFail($thread->id);

            // a strand the guard or a disconnect of GitHub paused waits for the admins (spec 11.3), never for a correction
            if ($locked->status === AgentThread::MERGED || $locked->status === AgentThread::CLOSED || in_array($locked->pause_reason, self::HELD, true)) {
                return null;
            }

            if ($resetBrakes) {
                $locked->forceFill(['corrections' => 0, 'conflicts' => 0, 'status' => AgentThread::OPEN, 'pause_reason' => null])->save();
            }

            if ($locked->status === AgentThread::PAUSED) {
                return null;
            }

            $waiting = $runs->first(fn (AgentRun $run) => $run->type === RunType::Correction && $run->status->pending());
            if ($waiting !== null) {
                $waiting->forceFill(['context' => [...$waiting->context, 'findings' => $waiting->context['findings']."\n\n".$findings]])->save();

                return $waiting;
            }

            if ($headSha !== null && AgentRun::query()->where('thread_id', $locked->id)->where('type', RunType::Correction->value)->where('head_sha', $headSha)
                ->whereNot('status', RunStatus::Canceled->value)->exists()) {
                return null;
            }

            $settings = AgentProjectSettings::of($locked->project_id);
            if (! Brakes::allows(RunType::Correction, $locked->corrections, $locked->conflicts, $settings->max_corrections, $settings->max_conflicts)) {
                PauseThread::run($actor, $locked, 'brake', $findings);

                return null;
            }

            $bot = User::query()->findOrFail($locked->bot_id);
            try {
                $run = EnqueueRun::run($actor, $bot, $item->project, $item, RunType::Correction->value, $locked, ['head_sha' => $headSha, 'source' => $source, 'findings' => $findings]);
            } catch (Problem) {
                return null;
            }

            $locked->forceFill(['corrections' => $locked->corrections + 1, 'merge_sha' => null])->save();
            AgentFlow::move($bot, $item, AgentStep::Correction);

            return $run;
        }, 3);
    }
}
