<?php

namespace App\GitHub;

use App\Models\GitHubApp;
use GuzzleHttp\Psr7\Utils;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Psr\Http\Message\RequestInterface;

/**
 * The calls werkbuch makes to the REST API of GitHub (spec 11.3), over Laravel's HTTP client: no state, no database.
 * Every call has the timeout of `werkbuch.github.timeout` (the conversion of a manifest its own, A720); a refusal or no answer is GitHubUnavailable (`github`) with
 * path and status, never a body. Lists are read in pages of 100 to their end; one that does not end within
 * `MAX_PAGES` or holds fewer rows than its `total_count` is GitHubUnavailable as well: a sync never takes part of a
 * list for all of it (a repo would look gone).
 */
final class GitHubApi
{
    public const API_VERSION = '2022-11-28';

    public const MAX_PAGES = 100;

    /**
     * Exchanges the temporary code of the manifest flow for the app (spec 10.2): `id`, `slug`, `name`, `owner`,
     * `html_url`, `client_id`, `pem`, `webhook_secret`, `permissions`, `events` (and a client secret werkbuch drops). It
     * waits `werkbuch.github.manifest_timeout` (A720): GitHub creates the app meanwhile and ends a request itself after
     * 10 s, so werkbuch hears GitHub's own answer instead of giving up at the same moment.
     *
     * @return array<string, mixed>
     */
    public static function convertManifest(string $code): array
    {
        return self::json(self::send(fn (PendingRequest $http) => $http->post('/app-manifests/'.rawurlencode($code).'/conversions'), 'conversions',
            (int) config('werkbuch.github.manifest_timeout')));
    }

    /**
     * The installations of the app.
     *
     * @return list<array<string, mixed>>
     */
    public static function installations(GitHubApp $app): array
    {
        return self::pages(fn (int $page) => self::send(fn (PendingRequest $http) => $http->withToken(AppJwt::for($app, time()))
            ->get('/app/installations', ['per_page' => 100, 'page' => $page]), 'installations'), null);
    }

    /**
     * An installation token (spec 11.3): valid an hour, limited to the repos and permissions given (all of the
     * installation without them).
     *
     * @param  list<int>|null  $repositoryIds
     * @param  array<string, string>|null  $permissions
     * @return array{token: string, expires_at: string}
     */
    public static function accessToken(GitHubApp $app, int $installationId, ?array $repositoryIds, ?array $permissions): array
    {
        $body = array_filter(['repository_ids' => $repositoryIds, 'permissions' => $permissions], fn ($value) => $value !== null);
        $answer = self::json(self::send(fn (PendingRequest $http) => $http->withToken(AppJwt::for($app, time()))
            ->post('/app/installations/'.$installationId.'/access_tokens', $body), 'access_tokens'));

        if (! is_string($answer['token'] ?? null) || ! is_string($answer['expires_at'] ?? null)) {
            throw new GitHubUnavailable(GitHubUnavailable::GITHUB, 'GitHub answered access_tokens without a token.', GitHubUnavailable::MALFORMED);
        }

        return ['token' => $answer['token'], 'expires_at' => $answer['expires_at']];
    }

    /**
     * The repos an installation token reaches.
     *
     * @return list<array<string, mixed>>
     */
    public static function repositories(string $token): array
    {
        return self::pages(fn (int $page) => self::send(fn (PendingRequest $http) => $http->withToken($token)
            ->get('/installation/repositories', ['per_page' => 100, 'page' => $page]), 'installation/repositories'), 'repositories');
    }

    /**
     * The active rules of a branch (rulesets of the repo and its organization).
     *
     * @return list<array<string, mixed>>
     */
    public static function branchRules(string $token, string $fullName, string $branch): array
    {
        return self::pages(fn (int $page) => self::send(fn (PendingRequest $http) => $http->withToken($token)
            ->get('/repos/'.self::repoPath($fullName).'/rules/branches/'.rawurlencode($branch), ['per_page' => 100, 'page' => $page]), 'rules/branches'), null);
    }

    /**
     * Writes a comment at a PR (an issue comment) and answers its ID.
     */
    public static function createComment(string $token, string $fullName, int $number, string $body): int
    {
        $answer = self::json(self::send(fn (PendingRequest $http) => $http->withToken($token)
            ->post('/repos/'.self::repoPath($fullName).'/issues/'.$number.'/comments', ['body' => $body]), 'issues/comments'));

        if (! is_int($answer['id'] ?? null)) {
            throw new GitHubUnavailable(GitHubUnavailable::GITHUB, 'GitHub answered issues/comments without an id.', GitHubUnavailable::MALFORMED);
        }

        return $answer['id'];
    }

    /**
     * Changes the text of a comment werkbuch wrote.
     */
    public static function updateComment(string $token, string $fullName, int $commentId, string $body): void
    {
        self::send(fn (PendingRequest $http) => $http->withToken($token)
            ->patch('/repos/'.self::repoPath($fullName).'/issues/comments/'.$commentId, ['body' => $body]), 'issues/comments');
    }

    /**
     * A pull request as GitHub has it now: its state, its head, whether it can be merged (`mergeable` is `null` while
     * GitHub still computes it) and its node ID (for GraphQL).
     *
     * @return array<array-key, mixed>
     */
    public static function pullRequest(string $token, string $fullName, int $number): array
    {
        return self::json(self::send(fn (PendingRequest $http) => $http->withToken($token)
            ->get('/repos/'.self::repoPath($fullName).'/pulls/'.$number), 'pulls'));
    }

    /**
     * Merges a pull request at its head commit (GitHub refuses with 409 when the head moved, with 405 when it cannot
     * merge) and answers the commit of the merge.
     */
    public static function mergePullRequest(string $token, string $fullName, int $number, string $sha, string $method): string
    {
        $answer = self::json(self::send(fn (PendingRequest $http) => $http->withToken($token)
            ->put('/repos/'.self::repoPath($fullName).'/pulls/'.$number.'/merge', ['sha' => $sha, 'merge_method' => $method]), 'pulls/merge'));

        if (! is_string($answer['sha'] ?? null)) {
            throw new GitHubUnavailable(GitHubUnavailable::GITHUB, 'GitHub answered pulls/merge without a sha.', GitHubUnavailable::MALFORMED);
        }

        return $answer['sha'];
    }

    /** Writes a review of a pull request at a commit: `APPROVE` or `COMMENT` (never `REQUEST_CHANGES`, spec 7.1). */
    public static function createReview(string $token, string $fullName, int $number, string $sha, string $event, string $body): void
    {
        self::send(fn (PendingRequest $http) => $http->withToken($token)
            ->post('/repos/'.self::repoPath($fullName).'/pulls/'.$number.'/reviews', ['commit_id' => $sha, 'event' => $event, 'body' => $body]), 'pulls/reviews');
    }

    /**
     * The check runs of a commit (A591: what came before werkbuch knew the commit as the head of a PR).
     *
     * @return list<array<string, mixed>>
     */
    public static function checkRuns(string $token, string $fullName, string $sha): array
    {
        return self::pages(fn (int $page) => self::send(fn (PendingRequest $http) => $http->withToken($token)
            ->get('/repos/'.self::repoPath($fullName).'/commits/'.rawurlencode($sha).'/check-runs', ['per_page' => 100, 'page' => $page]), 'check-runs'), 'check_runs');
    }

    /**
     * The workflow runs of GitHub Actions at a commit (A608): a run that waits (concurrency, an environment to approve)
     * has no check run yet.
     *
     * @return list<array<string, mixed>>
     */
    public static function workflowRuns(string $token, string $fullName, string $sha): array
    {
        return self::pages(fn (int $page) => self::send(fn (PendingRequest $http) => $http->withToken($token)
            ->get('/repos/'.self::repoPath($fullName).'/actions/runs', ['head_sha' => $sha, 'per_page' => 100, 'page' => $page]), 'actions/runs'), 'workflow_runs');
    }

    /**
     * The commit statuses of a commit, the latest per context (A608: CI that reports through the status API).
     *
     * @return list<array<string, mixed>>
     */
    public static function statuses(string $token, string $fullName, string $sha): array
    {
        return self::pages(fn (int $page) => self::send(fn (PendingRequest $http) => $http->withToken($token)
            ->get('/repos/'.self::repoPath($fullName).'/commits/'.rawurlencode($sha).'/status', ['per_page' => 100, 'page' => $page]), 'commits/status'), 'statuses');
    }

    /**
     * The bodies of the reviews of a pull request, or of the comments at it (`issues/{n}/comments`): to find what
     * werkbuch posted already.
     *
     * @return list<string>
     */
    public static function bodies(string $token, string $fullName, int $number, bool $reviews): array
    {
        $path = '/repos/'.self::repoPath($fullName).($reviews ? '/pulls/'.$number.'/reviews' : '/issues/'.$number.'/comments');
        $rows = self::pages(fn (int $page) => self::send(fn (PendingRequest $http) => $http->withToken($token)
            ->get($path, ['per_page' => 100, 'page' => $page]), $reviews ? 'pulls/reviews' : 'issues/comments'), null);

        return array_map(fn (array $row) => is_string($row['body'] ?? null) ? $row['body'] : '', $rows);
    }

    /** Marks a draft pull request ready for review (only GraphQL can). */
    public static function markReady(string $token, string $nodeId): void
    {
        $answer = self::json(self::send(fn (PendingRequest $http) => $http->withToken($token)->post('/graphql', [
            'query' => 'mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } } }',
            'variables' => ['id' => $nodeId],
        ]), 'graphql'));

        if (isset($answer['errors'])) {
            // only the types of the errors (FORBIDDEN, NOT_FOUND …), never their text: the message names no body
            $types = is_array($answer['errors']) ? array_filter(array_map(fn ($error) => is_array($error) && is_string($error['type'] ?? null)
                && preg_match('/^[A-Z_]{1,40}$/', $error['type']) === 1 ? $error['type'] : null, $answer['errors'])) : [];
            throw new GitHubUnavailable(GitHubUnavailable::GITHUB, 'GitHub refused markPullRequestReadyForReview'.($types === [] ? '' : ': '.implode(', ', array_unique($types))).'.', GitHubUnavailable::MALFORMED);
        }
    }

    /** Deletes a branch (after a merge). */
    public static function deleteBranch(string $token, string $fullName, string $branch): void
    {
        $path = '/repos/'.self::repoPath($fullName).'/git/refs/heads/'.implode('/', array_map('rawurlencode', explode('/', $branch)));
        // `send` with the method by name: ArchTest reads a call of the HTTP helper named after DELETE as a write of a model
        self::send(fn (PendingRequest $http) => $http->withToken($token)->send('DELETE', $path), 'git/refs');
    }

    /** `owner/name` with both parts encoded, never a path of its own. */
    private static function repoPath(string $fullName): string
    {
        return implode('/', array_map('rawurlencode', explode('/', $fullName, 2)));
    }

    /**
     * @param  callable(int): Response  $page
     * @return list<array<string, mixed>>
     */
    private static function pages(callable $page, ?string $key): array
    {
        $all = [];
        $total = null;
        for ($number = 1; $number <= self::MAX_PAGES; $number++) {
            $data = self::json($page($number));
            $rows = $key === null ? $data : ($data[$key] ?? []);
            $rows = is_array($rows) ? array_values(array_filter($rows, 'is_array')) : [];
            $total = $key !== null && is_int($data['total_count'] ?? null) ? $data['total_count'] : $total;
            array_push($all, ...$rows);
            if (count($rows) < 100) {
                if ($total !== null && count($all) < $total) {
                    throw new GitHubUnavailable(GitHubUnavailable::GITHUB, "GitHub answered {$total} rows of {$key} but gave ".count($all).'.', GitHubUnavailable::MALFORMED);
                }

                /** @var list<array<string, mixed>> $all */
                return $all;
            }
        }

        throw new GitHubUnavailable(GitHubUnavailable::GITHUB, 'GitHub answered more than '.self::MAX_PAGES.' pages.', GitHubUnavailable::MALFORMED);
    }

    /**
     * @param  callable(PendingRequest): Response  $call
     * @param  int|null  $timeout  seconds; by default `werkbuch.github.timeout`
     */
    private static function send(callable $call, string $what, ?int $timeout = null): Response
    {
        $http = Http::baseUrl((string) config('werkbuch.github.api_url'))
            ->timeout($timeout ?? (int) config('werkbuch.github.timeout'))
            ->connectTimeout(5)
            ->withHeaders(['Accept' => 'application/vnd.github+json', 'X-GitHub-Api-Version' => self::API_VERSION, 'User-Agent' => 'werkbuch/'.config('werkbuch.version')])
            ->withRequestMiddleware(self::noEmptyArray(...));

        try {
            $response = $call($http);
        } catch (ConnectionException) {
            throw new GitHubUnavailable(GitHubUnavailable::GITHUB, "GitHub did not answer {$what}.");
        }

        if (! $response->successful()) {
            throw new GitHubUnavailable(GitHubUnavailable::GITHUB, "GitHub refused {$what} with {$response->status()}.", $response->status());
        }

        return $response;
    }

    /**
     * A write without data goes as `{}` (WEBU-34): Laravel encodes the empty data of `post($url)` as the JSON `[]`, and
     * GitHub refuses an array where it reads an object with 422 ("[] is not a null or object"). Every call to GitHub
     * passes here, so none sends `[]`.
     */
    private static function noEmptyArray(RequestInterface $request): RequestInterface
    {
        return (string) $request->getBody() === '[]' ? $request->withBody(Utils::streamFor('{}')) : $request;
    }

    /**
     * @return array<array-key, mixed>
     */
    private static function json(Response $response): array
    {
        $data = $response->json();

        return is_array($data) ? $data : [];
    }
}
