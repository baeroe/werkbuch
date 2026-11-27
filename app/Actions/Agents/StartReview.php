<?php

namespace App\Actions\Agents;

use App\Actions\AgentRuns\CancelRun;
use App\Actions\AgentRuns\EnqueueRun;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Models\AgentProjectSettings;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A review of a PR once its CI is green on the head commit (spec 7.1, 7.2): once per head commit, with a fresh session.
 * The review agent of the project reviews; without one (or one that cannot work in the project) the bot of the strand
 * does, and PRs of persons are not reviewed. A review of an older commit of the PR that waits or runs is canceled: an
 * approve frees only its own commit. No review while a conflict of the strand waits or runs.
 */
final class StartReview
{
    use AsAction;

    /**
     * @param  array{repository_github_id: int, repository: string, number: int, head_sha: string, base_branch: string}  $pr
     */
    public function handle(Actor $actor, Project $project, array $pr, ?AgentThread $thread, ?WorkItem $item): ?AgentRun
    {
        return DB::transaction(function () use ($actor, $project, $pr, $thread, $item): ?AgentRun {
            $reviewer = self::reviewer($project, $thread);
            // a conflict goes before CI and review (spec 7.1): its push brings a new head commit
            if ($reviewer === null || ($thread !== null && AgentFlow::openRuns($thread, RunType::Conflict)->isNotEmpty())) {
                return null;
            }

            $reviews = AgentRun::query()->lockForUpdate()->where('repository_github_id', $pr['repository_github_id'])->where('pr_number', $pr['number'])
                ->where('type', RunType::Review->value)->whereNot('status', RunStatus::Canceled->value)->orderBy('id')->get();
            if ($reviews->contains(fn (AgentRun $run) => $run->head_sha === $pr['head_sha'] && ! ($run->context['superseded'] ?? false))) {
                return null;
            }

            foreach ($reviews->filter(fn (AgentRun $run) => ! $run->status->finished()) as $stale) {
                CancelRun::stop($actor, $stale);
            }

            // the reviewer can work in the project (AgentFlow::refusal): EnqueueRun never refuses it as switched off
            return EnqueueRun::run($actor, $reviewer, $project, $item, RunType::Review->value, $thread, [
                'head_sha' => $pr['head_sha'], 'repository_github_id' => $pr['repository_github_id'], 'pr_number' => $pr['number'],
                'repository' => $pr['repository'], 'base_branch' => $pr['base_branch'], 'person' => $thread === null,
            ]);
        }, 3);
    }

    /**
     * Cancels the reviews of a PR at other commits that wait or run (A596): a PR moved on, its review of the commit before
     * would approve what is no longer the PR. Answers how many.
     */
    public static function cancelStale(Actor $actor, int $repositoryGithubId, int $number, string $sha): int
    {
        return DB::transaction(function () use ($actor, $repositoryGithubId, $number, $sha): int {
            $stale = AgentRun::query()->lockForUpdate()->where('repository_github_id', $repositoryGithubId)->where('pr_number', $number)
                ->where('type', RunType::Review->value)->where('head_sha', '!=', $sha)
                ->whereIn('status', [RunStatus::Queued->value, RunStatus::Waiting->value, RunStatus::Running->value])->orderBy('id')->get();
            foreach ($stale as $run) {
                CancelRun::stop($actor, $run);
            }

            return $stale->count();
        }, 3);
    }

    /** Who reviews in the project: its review agent, else the bot of the strand (never for a PR of a person). */
    public static function reviewer(Project $project, ?AgentThread $thread): ?User
    {
        $settings = AgentProjectSettings::of($project->id);
        $agent = $settings->review_bot_id === null ? null : User::query()->find($settings->review_bot_id);
        if ($agent !== null && AgentFlow::refusal($agent, $project) === null) {
            return $agent;
        }

        $bot = $thread === null ? null : User::query()->find($thread->bot_id);

        return $bot !== null && AgentFlow::refusal($bot, $project) === null ? $bot : null;
    }
}
