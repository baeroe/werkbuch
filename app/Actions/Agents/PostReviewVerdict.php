<?php

namespace App\Actions\Agents;

use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\GitHub\InstallationTokens;
use App\Models\AgentRun;
use App\Models\ProjectRepository;
use App\Support\Actor;
use App\Support\AgentFlow;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Writes the verdict of a review at its PR (spec 7.1, 7.2), after the commit, with a token of werkbuch: at a PR of an
 * agent a comment (the app cannot approve its own PR), at a PR of a person a GitHub review, `APPROVE` for an approve,
 * `COMMENT` with the findings otherwise (never „request changes“: it would block the merge).
 */
final class PostReviewVerdict
{
    use AsAction;

    public const PERMISSIONS = ['pull_requests' => 'write'];

    /**
     * @throws GitHubUnavailable when GitHub does not answer (the job tries again)
     */
    public function handle(Actor $actor, string $runId): string
    {
        $run = AgentRun::query()->find($runId);
        $link = $run === null ? null : ProjectRepository::query()->with('repository.installation')->where('project_id', $run->project_id)->first();
        if ($run === null || $link === null || $run->pr_number === null || $run->head_sha === null) {
            return 'stale';
        }

        $verdict = $run->result['verdict'] ?? 'changes';
        $body = __('agents.pr.review.'.$verdict, ['sha' => substr($run->head_sha, 0, 7)], AgentFlow::locale())."\n\n".($run->result['text'] ?? '');
        $token = InstallationTokens::forLink($link, self::PERMISSIONS)['token'];

        if (($run->context['person'] ?? false) === true) {
            GitHubApi::createReview($token, $link->repository->full_name, $run->pr_number, $run->head_sha, $verdict === 'approve' ? 'APPROVE' : 'COMMENT', $body);

            return 'review';
        }

        GitHubApi::createComment($token, $link->repository->full_name, $run->pr_number, $body);

        return 'comment';
    }
}
