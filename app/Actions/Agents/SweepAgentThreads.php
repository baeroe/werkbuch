<?php

namespace App\Actions\Agents;

use App\Domain\Workflow\AgentStep;
use App\Jobs\LoadPullRequestChecks;
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
 * „Korrektur“); for a PR whose head commit came two minutes ago without any check GitHub is asked for its check runs
 * (LoadPullRequestChecks, A591: only a commit GitHub has none for counts green), and again for one whose workflow runs or
 * commit statuses still waited when GitHub was last asked (A608). Looks back a day at most, the oldest first. Answers how
 * many it handled.
 */
final class SweepAgentThreads
{
    use AsAction;

    public function handle(Actor $actor): int
    {
        $settled = now()->subMinutes(AgentFlow::SETTLE_MINUTES);
        $count = 0;

        foreach (AgentThread::query()->where('status', AgentThread::OPEN)->whereNull('pr_number')->where('awaiting_pr_since', '<=', $settled)
            ->orderBy('awaiting_pr_since')->orderBy('id')->limit(200)->get() as $thread) {
            $count += self::noPr($thread);
        }

        // a head without any check: GitHub is asked once more after it settled (A591), only that may count it green
        $quiet = WorkItemLink::query()->selectRaw('repository_github_id, head_sha, min(head_seen_at) as seen')->where('state', WorkItemLink::OPEN)->where('draft', false)
            ->whereBetween('head_seen_at', [now()->subDay(), $settled])
            ->where(fn ($unasked) => $unasked->whereNull('checks_loaded_at')->orWhereColumn('checks_loaded_sha', '!=', 'head_sha')
                ->orWhereRaw('checks_loaded_at < head_seen_at + interval '.AgentFlow::SETTLE_MINUTES.' minute'))
            ->whereNotExists(fn ($checks) => $checks->selectRaw('1')->from('work_item_link_checks')->whereColumn('work_item_link_checks.work_item_link_id', 'work_item_links.id')
                ->whereColumn('work_item_link_checks.head_sha', 'work_item_links.head_sha'))
            ->groupBy('repository_github_id', 'head_sha')->orderBy('seen')->limit(200)->get();
        foreach ($quiet as $link) {
            LoadPullRequestChecks::dispatch((int) $link->repository_github_id, (string) $link->head_sha);
            $count++;
        }

        // a workflow run or a commit status that waited when GitHub was asked: no delivery says when it ends (A608)
        $waiting = WorkItemLink::query()->selectRaw('repository_github_id, head_sha, min(checks_loaded_at) as loaded')->where('state', WorkItemLink::OPEN)->where('draft', false)
            ->whereColumn('checks_loaded_sha', 'head_sha')->whereBetween('checks_loaded_at', [now()->subDay(), $settled])
            ->whereExists(fn ($checks) => $checks->selectRaw('1')->from('work_item_link_checks')->whereColumn('work_item_link_checks.work_item_link_id', 'work_item_links.id')
                ->whereColumn('work_item_link_checks.head_sha', 'work_item_links.head_sha')->whereIn('kind', ['workflow', 'status'])->where('work_item_link_checks.status', '!=', 'completed'))
            ->groupBy('repository_github_id', 'head_sha')->orderBy('loaded')->limit(200)->get();
        foreach ($waiting as $link) {
            LoadPullRequestChecks::dispatch((int) $link->repository_github_id, (string) $link->head_sha);
            $count++;
        }

        return $count;
    }

    /** A strand without a PR two minutes after its task: a comment and „Korrektur“; read again under its lock. */
    public static function noPr(AgentThread $thread): int
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
