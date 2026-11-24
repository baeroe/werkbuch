<?php

namespace App\Actions\Agents;

use App\Models\AgentProjectSettings;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Models\WorkItemLinkCheck;
use App\Support\Actor;
use App\Support\AgentFlow;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The CI of a head commit of the repo of a project changed (spec 7.2; a `check_run`, a `check_suite`, or two minutes
 * without any check): for every open PR at that commit,
 * - of an agent (a strand at that head commit): red makes a correction with the failed checks (once per commit, the
 *   agent reads their logs, A511), green starts the review (not for a draft) and may merge (ApproveAndMerge);
 * - of a person: green and ready starts the review of the review agent, when the project reviews PRs of persons.
 * Results of older commits count nothing.
 */
final class HandleCheckResult
{
    use AsAction;

    public function handle(Actor $actor, int $repositoryGithubId, string $sha): string
    {
        $link = ProjectRepository::query()->with('project', 'repository')->whereHas('repository', fn ($query) => $query->where('github_id', $repositoryGithubId))->first();
        if ($link === null || $link->project->deleting_at !== null) {
            return 'ignored';
        }

        $links = WorkItemLink::query()->with('checks')->where('repository_github_id', $repositoryGithubId)->where('head_sha', $sha)
            ->where('state', WorkItemLink::OPEN)->orderBy('id')->get()->groupBy('number');
        $outcome = 'nothing';

        foreach ($links as $number => $ofPr) {
            /** @var WorkItemLink $first */
            $first = $ofPr->first();
            $ci = AgentFlow::ci($first);
            $pr = ['repository_github_id' => $repositoryGithubId, 'repository' => $first->repository, 'number' => (int) $number, 'head_sha' => $sha, 'base_branch' => $first->base_branch];
            $thread = AgentThread::query()->where('repository_github_id', $repositoryGithubId)->where('pr_number', $number)
                ->whereIn('status', [AgentThread::OPEN, AgentThread::PAUSED])->first();

            if ($thread !== null) {
                $outcome = self::agent($actor, $link->project, $thread, $first, $ci, $pr) ?? $outcome;

                continue;
            }

            if ($ci === 'success' && ! $first->draft && $first->thread_id === null && AgentProjectSettings::of($link->project_id)->review_person_prs) {
                $item = WorkItem::query()->whereKey($ofPr->pluck('work_item_id'))->orderBy('id')->first();
                $outcome = StartReview::run($actor, $link->project, $pr, null, $item) === null ? $outcome : 'review';
            }
        }

        return $outcome;
    }

    /**
     * @param  array{repository_github_id: int, repository: string, number: int, head_sha: string, base_branch: string}  $pr
     */
    private static function agent(Actor $actor, Project $project, AgentThread $thread, WorkItemLink $link, string $ci, array $pr): ?string
    {
        if ($thread->head_sha !== $pr['head_sha'] || $thread->status !== AgentThread::OPEN) {
            return null;
        }

        if ($ci === 'failure') {
            $failed = $link->checks->where('head_sha', $pr['head_sha'])->filter(fn (WorkItemLinkCheck $check) => $check->status === 'completed' && ! in_array($check->conclusion, ['success', 'neutral', 'skipped'], true))
                ->map(fn (WorkItemLinkCheck $check) => "- {$check->name}: {$check->conclusion}".($check->url === null ? '' : " ({$check->url})"))->implode("\n");

            return StartCorrection::run($actor, $thread, 'ci', __('agents.findings.ci', ['sha' => substr($pr['head_sha'], 0, 7)], AgentFlow::locale())."\n\n".$failed, $pr['head_sha']) === null ? null : 'correction';
        }

        if ($ci !== 'success' || $thread->pr_draft) {
            return null;
        }

        $item = WorkItem::query()->find($thread->work_item_id);
        $review = StartReview::run($actor, $project, $pr, $thread, $item);

        return ApproveAndMerge::run($actor, $thread) ? 'merge' : ($review === null ? null : 'review');
    }
}
