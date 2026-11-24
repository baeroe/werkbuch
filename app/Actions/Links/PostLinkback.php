<?php

namespace App\Actions\Links;

use App\Enums\Locale;
use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\GitHub\InstallationTokens;
use App\Models\GitHubPullRequestComment;
use App\Models\ProjectRepository;
use App\Models\WorkItemLink;
use App\Support\Actor;
use App\Support\AgentPullRequests;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The comment of werkbuch at a PR of a person (spec 12): one per PR, naming its items (key with a link into werkbuch,
 * whether the PR closes it), in the language of the organization, written by the app. A second call writes only when
 * the text changed: the first one at a PR creates the comment, later ones change it (a comment someone deleted is
 * written anew). Keys only, no titles: the readers of a repo need not be readers of the project (A545). No comment at
 * a PR of an agent (spec 7.1: a run writes no comment). The token may comment and nothing more. HTTP happens outside of
 * any transaction; the job (PostPullRequestComment) runs one call per PR at a time. Answers `posted`, `updated`,
 * `unchanged` or `skipped`.
 *
 * @throws GitHubUnavailable when GitHub refuses or does not answer (the job tries again)
 */
final class PostLinkback
{
    use AsAction;

    /** The first line of the comment: how a reader of its source knows it. */
    public const MARK = '<!-- werkbuch:links -->';

    /** What the token of the comment may do. */
    public const PERMISSIONS = ['pull_requests' => 'write', 'metadata' => 'read'];

    public function handle(Actor $actor, int $repositoryGithubId, int $number): string
    {
        $repo = ProjectRepository::query()->with('repository.installation')
            ->whereHas('repository', fn ($query) => $query->where('github_id', $repositoryGithubId))->first();
        $links = WorkItemLink::query()->with('workItem.project')->where('repository_github_id', $repositoryGithubId)->where('number', $number)->get()
            ->sortBy(fn (WorkItemLink $link) => [$link->workItem->number])->values();
        $row = GitHubPullRequestComment::query()->where('repository_github_id', $repositoryGithubId)->where('number', $number)->first();
        $agent = $links->contains(fn (WorkItemLink $link) => AgentPullRequests::isAgent(null, $link->author) || $link->thread_id !== null);

        if ($repo === null || $agent || ($links->isEmpty() && $row?->comment_id === null)) {
            return 'skipped';
        }

        $body = self::body(array_values($links->all()));
        $hash = hash('sha256', $body);

        if ($row?->body_hash === $hash) {
            return 'unchanged';
        }

        $token = InstallationTokens::forLink($repo, self::PERMISSIONS)['token'];
        $fullName = $repo->repository->full_name;
        $id = $row?->comment_id;
        $outcome = 'updated';

        if ($id !== null) {
            try {
                GitHubApi::updateComment($token, $fullName, $id, $body);
            } catch (GitHubUnavailable $e) {
                if ($e->status !== 404) {
                    throw $e;
                }

                $id = null;
            }
        }

        if ($id === null) {
            $id = GitHubApi::createComment($token, $fullName, $number, $body);
            $outcome = 'posted';
        }

        GitHubPullRequestComment::query()->updateOrCreate(
            ['repository_github_id' => $repositoryGithubId, 'number' => $number],
            ['comment_id' => $id, 'body_hash' => $hash],
        );

        return $outcome;
    }

    /**
     * The text of the comment for these links (in the order of the items' numbers).
     *
     * @param  list<WorkItemLink>  $links
     */
    public static function body(array $links): string
    {
        $locale = Locale::default()->value;
        $url = rtrim((string) config('app.url'), '/');

        if ($links === []) {
            return self::MARK."\n".__('github.links.comment.none', [], $locale);
        }

        $lines = array_map(function (WorkItemLink $link) use ($locale, $url): string {
            $key = $link->workItem->key;
            $line = "- [{$key}]({$url}/items/{$key})";

            return $link->closes ? $line.': '.__('github.links.comment.closes', [], $locale) : $line;
        }, $links);

        return self::MARK."\n".__('github.links.comment.title', [], $locale)."\n\n".implode("\n", $lines);
    }
}
