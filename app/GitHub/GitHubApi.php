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
 * path and status, never a body. Lists are read in pages of 100, at most `MAX_PAGES`.
 */
final class GitHubApi
{
    public const API_VERSION = '2022-11-28';

    public const MAX_PAGES = 10;

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
            throw new GitHubUnavailable(GitHubUnavailable::GITHUB, 'GitHub answered access_tokens without a token.');
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
        for ($number = 1; $number <= self::MAX_PAGES; $number++) {
            $data = self::json($page($number));
            $rows = $key === null ? $data : ($data[$key] ?? []);
            $rows = is_array($rows) ? array_values(array_filter($rows, 'is_array')) : [];
            array_push($all, ...$rows);
            if (count($rows) < 100) {
                break;
            }
        }

        /** @var list<array<string, mixed>> $all */
        return $all;
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
