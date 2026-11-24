<?php

namespace Tests\Support;

use App\Domain\GitHub\WebhookSignature;
use App\Models\GitHubApp;
use App\Models\GitHubInstallation;
use App\Models\GitHubRepository;
use App\Models\Project;
use App\Models\ProjectRepository;
use Closure;
use Database\Factories\GitHubAppFactory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A false GitHub for the tests (WEBU-24): the REST API behind `Http::fake` with answers in the form of the real one
 * (`app-manifests/{code}/conversions`, `app/installations`, `…/access_tokens`, `installation/repositories`,
 * `repos/{owner}/{repo}/rules/branches/{branch}`), webhook payloads in the form of the documentation, signed for real
 * with HMAC-SHA256. `issued()` names the tokens it handed out, `requests()` what werkbuch asked.
 */
final class FakeGitHub
{
    public const API = 'https://api.github.com';

    /** @var list<string> */
    public array $tokens = [];

    /** @var array<string, int> token → installation ID */
    private array $issuedFor = [];

    /** @var array<int, list<array<string, mixed>>> installation ID → repos */
    public array $repositories = [];

    /** @var list<array<string, mixed>> */
    public array $installations = [];

    /** @var array<string, list<array<string, mixed>>> `owner/name:branch` → rules */
    public array $rules = [];

    /** @var array<string, int> path pattern → status GitHub refuses with */
    public array $refuse = [];

    /** The `total_count` GitHub claims for the repos of an installation (null: as many as there are). */
    public ?int $totalCount = null;

    /** Whether the repos of an installation never end: every page is full. */
    public bool $endless = false;

    public ?string $conversionPem = null;

    /** @var array<string, mixed> keys of the conversion answer to change (`null` removes one), for an answer GitHub should not give */
    public array $conversionChanges = [];

    /** @var list<array{id: int, number: int, body: string, repository: string}> the comments werkbuch wrote at PRs */
    public array $comments = [];

    /** @var array<string, mixed>|null an answer to a new comment GitHub should not give */
    public ?array $commentAnswer = null;

    /** @var list<int> comment IDs GitHub no longer knows (someone deleted them) */
    public array $deletedComments = [];

    /** @var array<int, array<string, mixed>> PR number → the PR as GitHub answers it (`head.sha`, `mergeable`, `mergeable_state`, `draft`, `state`) */
    public array $pulls = [];

    /** @var list<array{number: int, sha: string, method: string}> the merges werkbuch asked for */
    public array $merges = [];

    /** @var list<array{number: int, sha: string, event: string, body: string}> the reviews werkbuch wrote */
    public array $reviews = [];

    /** @var list<string> the node IDs of the PRs werkbuch marked ready */
    public array $ready = [];

    /** @var list<string> the branches werkbuch deleted */
    public array $deletedBranches = [];

    /** @var array<string, mixed>|null an answer to a merge GitHub should not give */
    public ?array $mergeAnswer = null;

    /** The commit GitHub answers a merge with. */
    public string $mergeSha = 'f00dfeed00000000000000000000000000000001';

    /** Runs before every answer with the request (something that happens while GitHub answers). */
    public ?Closure $meanwhile = null;

    /** @var array<string, list<array<string, mixed>>> the check runs of a commit as GET /commits/{sha}/check-runs lists them */
    public array $checkRuns = [];

    /** @var list<string> the commits whose check runs werkbuch asked for */
    public array $checkRunCalls = [];

    /**
     * The app, an installation of `feldwerk` and one repo `feldwerk/website` (default branch `main`), and the fake.
     */
    public static function connected(): self
    {
        $fake = new self;
        GitHubApp::factory()->create();
        $installation = GitHubInstallation::factory()->create(['installation_id' => 55_000_001]);
        GitHubRepository::factory()->create(['installation_id' => $installation->id, 'github_id' => 700_000_001, 'full_name' => 'feldwerk/website', 'html_url' => 'https://github.com/feldwerk/website']);

        $fake->installations = [self::installationJson(55_000_001)];
        $fake->repositories = [55_000_001 => [self::repositoryJson(700_000_001, 'feldwerk/website')]];
        $fake->fake();

        return $fake;
    }

    /** A project with the repo `feldwerk/website` on `main`. */
    public static function link(Project $project, string $fullName = 'feldwerk/website', string $branch = 'main'): ProjectRepository
    {
        $repository = GitHubRepository::query()->where('full_name', $fullName)->firstOrFail();

        return ProjectRepository::factory()->create(['project_id' => $project->id, 'repository_id' => $repository->id, 'base_branch' => $branch]);
    }

    public function fake(): self
    {
        Http::fake(fn (Request $request) => $this->answer($request));

        return $this;
    }

    private function answer(Request $request): mixed
    {
        if ($this->meanwhile !== null) {
            ($this->meanwhile)($request);
        }

        $path = (string) parse_url($request->url(), PHP_URL_PATH);
        foreach ($this->refuse as $pattern => $status) {
            if (Str::is($pattern, $path)) {
                return Http::response(['message' => 'Refused by the fake', 'documentation_url' => 'https://docs.github.com/rest'], $status);
            }
        }

        $page = (int) ($request->data()['page'] ?? 1);

        return match (true) {
            Str::is('/app-manifests/*/conversions', $path) => Http::response($this->conversion(), 201),
            $path === '/app/installations' => Http::response($page === 1 ? $this->installations : [], 200),
            Str::is('/app/installations/*/access_tokens', $path) => Http::response($this->token($request), 201),
            $path === '/installation/repositories' => Http::response($this->repositoriesFor($request), 200),
            Str::is('/repos/*/*/rules/branches/*', $path) => Http::response($this->rulesFor($path), 200),
            Str::is('/repos/*/*/issues/*/comments', $path) && $request->method() === 'POST' => Http::response($this->commentAnswer ?? $this->comment($path, $request), 201),
            Str::is('/repos/*/*/issues/comments/*', $path) && $request->method() === 'PATCH' => $this->editComment($path, $request),
            Str::is('/repos/*/*/pulls/*/merge', $path) && $request->method() === 'PUT' => $this->merge($path, $request),
            Str::is('/repos/*/*/pulls/*/reviews', $path) && $request->method() === 'POST' => $this->review($path, $request),
            Str::is('/repos/*/*/pulls/*/reviews', $path) && $request->method() === 'GET' => Http::response($page === 1 ? array_values(array_map(fn (array $review) => ['body' => $review['body']], $this->reviews)) : [], 200),
            Str::is('/repos/*/*/issues/*/comments', $path) && $request->method() === 'GET' => Http::response($page === 1 ? array_values(array_map(fn (array $comment) => ['body' => $comment['body']], $this->comments)) : [], 200),
            Str::is('/repos/*/*/commits/*/check-runs', $path) => $this->checkRunsOf(explode('/', $path)[5], $page),
            Str::is('/repos/*/*/pulls/*', $path) && $request->method() === 'GET' => $this->pull((int) last(explode('/', $path))),
            $path === '/graphql' => $this->graphql($request),
            Str::is('/repos/*/*/git/refs/heads/*', $path) && $request->method() === 'DELETE' => $this->deleteBranch($path),
            default => Http::response(['message' => 'Not Found'], 404),
        };
    }

    /** @return array<string, mixed> */
    private function conversion(): array
    {
        $this->conversionPem ??= GitHubAppFactory::privateKey();

        return array_filter([...[
            'id' => 4_200_123, 'slug' => 'feldwerk-werkbuch', 'node_id' => 'A_kwDOBfake', 'name' => 'Feldwerk werkbuch',
            'owner' => ['login' => 'feldwerk', 'id' => 9_001, 'type' => 'Organization'],
            'description' => 'werkbuch', 'external_url' => 'https://werkbuch.example.com', 'html_url' => 'https://github.com/apps/feldwerk-werkbuch',
            'created_at' => '2026-11-23T10:00:00Z', 'updated_at' => '2026-11-23T10:00:00Z',
            'permissions' => ['contents' => 'write', 'pull_requests' => 'write', 'checks' => 'read', 'actions' => 'read', 'metadata' => 'read'],
            'events' => ['check_run', 'check_suite', 'pull_request', 'push'],
            'client_id' => 'Iv23liFake', 'client_secret' => 'client-secret-'.Str::random(20),
            'webhook_secret' => 'whsec-fake-'.Str::random(24), 'pem' => $this->conversionPem,
        ], ...$this->conversionChanges], fn (mixed $value) => $value !== null);
    }

    /** @return array<string, mixed> a comment at a PR as GitHub answers it */
    private function comment(string $path, Request $request): array
    {
        $parts = explode('/', $path);
        $id = 900_000_000 + count($this->comments) + 1;
        $this->comments[] = ['id' => $id, 'number' => (int) $parts[5], 'body' => (string) ($request->data()['body'] ?? ''), 'repository' => $parts[2].'/'.$parts[3]];

        return ['id' => $id, 'html_url' => "https://github.com/{$parts[2]}/{$parts[3]}/pull/{$parts[5]}#issuecomment-{$id}", 'body' => $request->data()['body'] ?? ''];
    }

    private function editComment(string $path, Request $request): mixed
    {
        $id = (int) last(explode('/', $path));
        if (in_array($id, $this->deletedComments, true)) {
            return Http::response(['message' => 'Not Found'], 404);
        }

        foreach ($this->comments as $index => $comment) {
            if ($comment['id'] === $id) {
                $this->comments[$index]['body'] = (string) ($request->data()['body'] ?? '');
            }
        }

        return Http::response(['id' => $id, 'body' => $request->data()['body'] ?? ''], 200);
    }

    /** A PR as GET /pulls/{n} answers it; one the test did not set is open, clean, at a head of `b`. */
    private function pull(int $number): mixed
    {
        $pr = $this->pulls[$number] ?? [];

        return Http::response([
            'number' => $number, 'node_id' => 'PR_fake'.$number, 'state' => 'open', 'draft' => false, 'mergeable' => true, 'mergeable_state' => 'clean',
            ...$pr, 'head' => ['sha' => $pr['head']['sha'] ?? str_repeat('b', 40), 'ref' => $pr['head']['ref'] ?? "feature-{$number}"],
        ], 200);
    }

    /** The check runs of a commit as GitHub lists them (A591), from `checkRuns`; the test sees each call in `checkRunCalls`. */
    private function checkRunsOf(string $sha, int $page): mixed
    {
        $this->checkRunCalls[] = $sha;
        $runs = $page === 1 ? ($this->checkRuns[$sha] ?? []) : [];

        return Http::response(['total_count' => count($this->checkRuns[$sha] ?? []), 'check_runs' => $runs], 200);
    }

    private function merge(string $path, Request $request): mixed
    {
        $number = (int) explode('/', $path)[5];
        $this->merges[] = ['number' => $number, 'sha' => (string) ($request->data()['sha'] ?? ''), 'method' => (string) ($request->data()['merge_method'] ?? '')];

        return Http::response($this->mergeAnswer ?? ['sha' => $this->mergeSha, 'merged' => true, 'message' => 'Pull Request successfully merged'], 200);
    }

    private function review(string $path, Request $request): mixed
    {
        $data = $request->data();
        $this->reviews[] = ['number' => (int) explode('/', $path)[5], 'sha' => (string) ($data['commit_id'] ?? ''), 'event' => (string) ($data['event'] ?? ''), 'body' => (string) ($data['body'] ?? '')];

        return Http::response(['id' => 80_000_000 + count($this->reviews), 'state' => ($data['event'] ?? '') === 'APPROVE' ? 'APPROVED' : 'COMMENTED'], 200);
    }

    private function graphql(Request $request): mixed
    {
        $this->ready[] = (string) ($request->data()['variables']['id'] ?? '');

        return Http::response(['data' => ['markPullRequestReadyForReview' => ['pullRequest' => ['isDraft' => false]]]], 200);
    }

    private function deleteBranch(string $path): mixed
    {
        $this->deletedBranches[] = rawurldecode(implode('/', array_slice(explode('/', $path), 7)));

        return Http::response(null, 204);
    }

    /** @return array<string, mixed> */
    private function token(Request $request): array
    {
        $token = 'ghs_'.Str::random(36);
        $this->tokens[] = $token;
        $this->issuedFor[$token] = (int) explode('/', (string) parse_url($request->url(), PHP_URL_PATH))[3];
        $body = $request->data();

        return [
            'token' => $token,
            'expires_at' => now()->addHour()->utc()->format('Y-m-d\TH:i:s\Z'),
            'permissions' => $body['permissions'] ?? ['metadata' => 'read'],
            'repository_selection' => isset($body['repository_ids']) ? 'selected' : 'all',
        ];
    }

    /** @return array<string, mixed> the repos of the installation the bearer token was issued for */
    private function repositoriesFor(Request $request): array
    {
        $token = str_replace('Bearer ', '', $request->header('Authorization')[0] ?? '');
        $repositories = $this->repositories[$this->issuedFor[$token] ?? 0] ?? [];

        if ($this->endless) {
            $repositories = array_map(fn (int $n) => self::repositoryJson(800_000_000 + $n, "feldwerk/r{$n}"), range(1, (int) ($request->data()['per_page'] ?? 100)));

            return ['total_count' => 1_000_000, 'repositories' => $repositories];
        }

        return ['total_count' => $this->totalCount ?? count($repositories), 'repositories' => (int) ($request->data()['page'] ?? 1) === 1 ? $repositories : []];
    }

    /** @return list<array<string, mixed>> */
    private function rulesFor(string $path): array
    {
        $parts = explode('/', $path);
        $key = rawurldecode($parts[2]).'/'.rawurldecode($parts[3]).':'.rawurldecode(implode('/', array_slice($parts, 6)));

        return $this->rules[$key] ?? [];
    }

    /** @return array<string, mixed> an installation as GET /app/installations has it */
    public static function installationJson(int $id, string $login = 'feldwerk', ?string $suspended = null): array
    {
        return [
            'id' => $id, 'client_id' => 'Iv23liFake', 'app_id' => 4_200_123, 'app_slug' => 'feldwerk-werkbuch', 'target_id' => 9_001,
            'target_type' => 'Organization', 'account' => ['login' => $login, 'id' => 9_001, 'type' => 'Organization'],
            'repository_selection' => 'selected', 'access_tokens_url' => self::API."/app/installations/{$id}/access_tokens",
            'permissions' => ['contents' => 'write', 'metadata' => 'read'], 'events' => ['push'],
            'created_at' => '2026-11-23T10:00:00Z', 'updated_at' => '2026-11-23T10:00:00Z', 'suspended_at' => $suspended, 'suspended_by' => null,
        ];
    }

    /** @return array<string, mixed> a repo as GET /installation/repositories has it */
    public static function repositoryJson(int $id, string $fullName, string $branch = 'main'): array
    {
        [$owner, $name] = explode('/', $fullName);

        return [
            'id' => $id, 'node_id' => 'R_fake'.$id, 'name' => $name, 'full_name' => $fullName, 'private' => true,
            'owner' => ['login' => $owner, 'id' => 9_001, 'type' => 'Organization'],
            'html_url' => "https://github.com/{$fullName}", 'clone_url' => "https://github.com/{$fullName}.git",
            'default_branch' => $branch, 'visibility' => 'private',
        ];
    }

    /**
     * A `push` payload as GitHub sends it.
     *
     * @return array<string, mixed>
     */
    public static function push(string $sha, string $branch = 'main', string $sender = 'feldwerk-werkbuch[bot]', int $repositoryId = 700_000_001, string $fullName = 'feldwerk/website'): array
    {
        return [
            'ref' => "refs/heads/{$branch}", 'before' => str_repeat('1', 40), 'after' => $sha,
            'created' => false, 'deleted' => false, 'forced' => false, 'base_ref' => null,
            'compare' => "https://github.com/{$fullName}/compare/111111111111...".substr($sha, 0, 12),
            'commits' => [['id' => $sha, 'message' => 'Change things', 'author' => ['name' => 'Kira', 'email' => 'kira@users.noreply.example.com']]],
            'head_commit' => ['id' => $sha, 'message' => 'Change things'],
            'repository' => self::repositoryJson($repositoryId, $fullName),
            'pusher' => ['name' => $sender, 'email' => null],
            'sender' => ['login' => $sender, 'id' => 123_456, 'type' => str_ends_with($sender, '[bot]') ? 'Bot' : 'User'],
            'installation' => ['id' => 55_000_001, 'node_id' => 'MDIzOkludGVncmF0aW9uSW5zdGFsbGF0aW9uNTU='],
        ];
    }

    /**
     * A `pull_request` payload as GitHub sends it: `$pr` changes keys of the PR (`title`, `body`, `draft`, `state`,
     * `merged`, `merged_at`, `head` …).
     *
     * @param  array<string, mixed>  $pr
     * @return array<string, mixed>
     */
    public static function pullRequest(string $action, int $number, array $pr = [], int $repositoryId = 700_000_001, string $fullName = 'feldwerk/website'): array
    {
        $user = is_string($pr['author'] ?? null) ? $pr['author'] : 'mara-feldwerk';
        unset($pr['author']);

        return [
            'action' => $action,
            'number' => $number,
            'pull_request' => [
                'url' => self::API."/repos/{$fullName}/pulls/{$number}", 'id' => 1_500_000_000 + $number, 'node_id' => 'PR_fake'.$number,
                'html_url' => "https://github.com/{$fullName}/pull/{$number}", 'number' => $number, 'state' => 'open', 'locked' => false,
                'title' => 'Change things', 'body' => null, 'draft' => false, 'merged' => false, 'merged_at' => null, 'closed_at' => null,
                'user' => ['login' => $user, 'id' => 77_001, 'type' => str_ends_with($user, '[bot]') ? 'Bot' : 'User'],
                'head' => ['label' => "feldwerk:feature-{$number}", 'ref' => "feature-{$number}", 'sha' => str_repeat('b', 40)],
                'base' => ['label' => 'feldwerk:main', 'ref' => 'main', 'sha' => str_repeat('c', 40)],
                'created_at' => '2026-11-24T09:00:00Z', 'updated_at' => '2026-11-24T09:00:00Z',
                ...$pr,
            ],
            'repository' => self::repositoryJson($repositoryId, $fullName),
            'sender' => ['login' => $user, 'id' => 77_001, 'type' => 'User'],
            'installation' => ['id' => 55_000_001],
        ];
    }

    /**
     * A `check_run` payload as GitHub sends it.
     *
     * @return array<string, mixed>
     */
    public static function checkRun(string $sha, string $status, ?string $conclusion = null, int $id = 3_000_001, string $name = 'tests', int $repositoryId = 700_000_001): array
    {
        return [
            'action' => $status === 'completed' ? 'completed' : 'created',
            'check_run' => [
                'id' => $id, 'name' => $name, 'head_sha' => $sha, 'status' => $status, 'conclusion' => $conclusion,
                'html_url' => "https://github.com/feldwerk/website/runs/{$id}", 'details_url' => "https://github.com/feldwerk/website/actions/runs/{$id}",
                'started_at' => '2026-11-24T09:01:00Z', 'completed_at' => $status === 'completed' ? '2026-11-24T09:05:00Z' : null,
                'app' => ['id' => 15_368, 'slug' => 'github-actions', 'name' => 'GitHub Actions'],
                'check_suite' => ['id' => 4_000_001, 'head_branch' => 'feature', 'head_sha' => $sha],
                'pull_requests' => [],
            ],
            'repository' => self::repositoryJson($repositoryId, 'feldwerk/website'),
            'sender' => ['login' => 'github-actions[bot]', 'id' => 41_898_282, 'type' => 'Bot'],
            'installation' => ['id' => 55_000_001],
        ];
    }

    /**
     * A `check_suite` payload as GitHub sends it.
     *
     * @return array<string, mixed>
     */
    public static function checkSuite(string $sha, string $action = 'completed', ?string $conclusion = 'success', int $repositoryId = 700_000_001): array
    {
        return [
            'action' => $action,
            'check_suite' => ['id' => 4_000_001, 'head_branch' => 'feature', 'head_sha' => $sha, 'status' => $action === 'completed' ? 'completed' : 'queued', 'conclusion' => $conclusion,
                'app' => ['id' => 15_368, 'slug' => 'github-actions', 'name' => 'GitHub Actions'], 'pull_requests' => []],
            'repository' => self::repositoryJson($repositoryId, 'feldwerk/website'),
            'sender' => ['login' => 'github-actions[bot]', 'id' => 41_898_282, 'type' => 'Bot'],
            'installation' => ['id' => 55_000_001],
        ];
    }

    /**
     * Posts a delivery to the webhook, signed with the secret given (default: the app's).
     *
     * @param  array<string, mixed>  $payload
     */
    public static function deliver(TestCase $test, string $event, array $payload, ?string $delivery = null, ?string $secret = null, ?string $signature = null): TestResponse
    {
        $body = (string) json_encode($payload, JSON_UNESCAPED_SLASHES);
        $secret ??= GitHubApp::query()->firstOrFail()->webhook_secret;

        return $test->call('POST', '/github/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_ACCEPT' => '*/*',
            'HTTP_USER_AGENT' => 'GitHub-Hookshot/abc1234',
            'HTTP_X_GITHUB_EVENT' => $event,
            'HTTP_X_GITHUB_DELIVERY' => $delivery ?? (string) Str::uuid(),
            'HTTP_X_GITHUB_HOOK_ID' => '501',
            'HTTP_X_GITHUB_HOOK_INSTALLATION_TARGET_TYPE' => 'integration',
            'HTTP_X_HUB_SIGNATURE_256' => $signature ?? WebhookSignature::sign($secret, $body),
        ], $body);
    }
}
