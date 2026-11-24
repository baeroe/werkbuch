<?php

namespace App\Actions\Agents;

use App\Domain\Workflow\AgentStep;
use App\Models\AgentThread;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Every minute (spec 7.2): a strand whose task ended two minutes ago without a PR never got one (a comment and
 * „Korrektur“); a PR whose head commit came two minutes ago without any check counts as green (HandleCheckResult, its
 * review and merge are once per commit). Looks back a day at most. Answers how many it handled.
 */
final class SweepAgentThreads
{
    use AsAction;

    public function handle(Actor $actor): int
    {
        $settled = now()->subMinutes(AgentFlow::SETTLE_MINUTES);
        $count = 0;

        foreach (AgentThread::query()->where('status', AgentThread::OPEN)->whereNull('pr_number')->where('awaiting_pr_since', '<=', $settled)->orderBy('id')->limit(200)->get() as $thread) {
            $count += self::noPr($thread);
        }

        $quiet = WorkItemLink::query()->select('repository_github_id', 'head_sha')->distinct()->where('state', WorkItemLink::OPEN)->where('draft', false)
            ->whereBetween('head_seen_at', [now()->subDay(), $settled])
            ->whereNotExists(fn ($checks) => $checks->selectRaw('1')->from('work_item_link_checks')->whereColumn('work_item_link_checks.work_item_link_id', 'work_item_links.id')
                ->whereColumn('work_item_link_checks.head_sha', 'work_item_links.head_sha'))
            ->limit(200)->get();
        foreach ($quiet as $link) {
            $count += HandleCheckResult::run($actor, $link->repository_github_id, $link->head_sha) === 'nothing' ? 0 : 1;
        }

        return $count;
    }

    private static function noPr(AgentThread $thread): int
    {
        return DB::transaction(function () use ($thread): int {
            $item = WorkItem::query()->findOrFail($thread->work_item_id);
            ItemLock::take($item);
            $locked = AgentThread::query()->lockForUpdate()->findOrFail($thread->id);
            if ($locked->pr_number !== null || $locked->awaiting_pr_since === null) {
                return 0;
            }

            $locked->forceFill(['awaiting_pr_since' => null])->save();
            $bot = User::query()->findOrFail($locked->bot_id);
            AgentFlow::comment($bot, $item, __('agents.comment.no_pr', [], AgentFlow::locale()));
            AgentFlow::move($bot, $item, AgentStep::Correction);

            return 1;
        }, 3);
    }
}
