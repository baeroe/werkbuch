<?php

namespace App\GitHub;

use App\Models\GitHubApp;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * The calls werkbuch makes to the REST API of GitHub (spec 11.3), over Laravel's HTTP client: no state, no database.
 * Every call has the timeout of `werkbuch.github.timeout`; a refusal or no answer is GitHubUnavailable (`github`) with
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
     * `html_url`, `client_id`, `pem`, `webhook_secret`, `permissions`, `events` (and a client secret werkbuch drops).
     *
     * @return array<string, mixed>
     */
    public static function convertManifest(string $code): array
    {
        return self::json(self::send(fn (PendingRequest $http) => $http->post('/app-manifests/'.rawurlencode($code).'/conversions'), 'conversions'));
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
     */
    private static function send(callable $call, string $what): Response
    {
        $http = Http::baseUrl((string) config('werkbuch.github.api_url'))
            ->timeout((int) config('werkbuch.github.timeout'))
            ->connectTimeout(5)
            ->withHeaders(['Accept' => 'application/vnd.github+json', 'X-GitHub-Api-Version' => self::API_VERSION, 'User-Agent' => 'werkbuch/'.config('werkbuch.version')]);

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
     * @return array<array-key, mixed>
     */
    private static function json(Response $response): array
    {
        $data = $response->json();

        return is_array($data) ? $data : [];
    }
}
