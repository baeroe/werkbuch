<?php

namespace App\Actions\Agents;

use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\GitHub\InstallationTokens;
use App\Models\AgentRun;
use App\Models\ProjectRepository;
use App\Models\WorkItemLink;
use App\Support\Actor;
use App\Support\AgentFlow;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Writes the verdict of a review at its PR (spec 7.1, 7.2), after the commit, with a token of werkbuch: at a PR of an
 * agent a comment (the app cannot approve its own PR), at a PR of a person a GitHub review, `APPROVE` for an approve,
 * `COMMENT` with the findings otherwise (never „request changes“: it would block the merge); a PR of a person that moved
 * on gets nothing (A596). Every text carries the mark of its run: a try after a lost answer posts nothing twice (A602).
 */
final class PostReviewVerdict
{
    use AsAction;

    public const PERMISSIONS = ['pull_requests' => 'write'];

    /**
     * @throws GitHubUnavailable when GitHub does not answer (the job tries again)
     */
    public function handle(Actor $actor, string $runId, bool $retry = false): string
    {
        $run = AgentRun::query()->find($runId);
        $link = $run === null ? null : ProjectRepository::query()->with('repository.installation.app')->where('project_id', $run->project_id)->first();
        if ($run === null || $link === null || $run->pr_number === null || $run->head_sha === null) {
            return 'stale';
        }

        $person = ($run->context['person'] ?? false) === true;
        // a PR of a person that moved on gets no approve of the commit it left (A596)
        if ($person && WorkItemLink::query()->where('repository_github_id', $run->repository_github_id)->where('number', $run->pr_number)->where('head_sha', '!=', $run->head_sha)->exists()) {
            return 'stale';
        }

        $verdict = $run->result['verdict'] ?? 'changes';
        $mark = self::mark($run);
        $body = __('agents.pr.review.'.$verdict, ['sha' => substr($run->head_sha, 0, 7)], AgentFlow::locale())."\n\n".($run->result['text'] ?? '')."\n\n".$mark;
        $token = InstallationTokens::forLink($link, self::PERMISSIONS)['token'];

        // a try after one whose answer got lost: what GitHub has with the mark of the run is posted (A602)
        if ($retry && collect(GitHubApi::bodies($token, $link->repository->full_name, $run->pr_number, $person))->contains(fn (string $text) => str_contains($text, $mark))) {
            return 'posted';
        }

        if ($person) {
            GitHubApi::createReview($token, $link->repository->full_name, $run->pr_number, $run->head_sha, $verdict === 'approve' ? 'APPROVE' : 'COMMENT', $body);

            return 'review';
        }

        GitHubApi::createComment($token, $link->repository->full_name, $run->pr_number, $body);

        return 'comment';
    }

    /** The mark of a run in what it posts: an HTML comment, unseen on GitHub. */
    public static function mark(AgentRun $run): string
    {
        return "<!-- werkbuch-run:{$run->id} -->";
    }
}
