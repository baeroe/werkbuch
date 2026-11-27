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
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A false GitHub for the tests (WEBU-24): the REST API behind `Http::fake` with answers in the form of the real one
 * (`app-manifests/{code}/conversions`, `app/installations`, `…/access_tokens`, `installation/repositories`,
 * `repos/{owner}/{repo}/rules/branches/{branch}`), webhook payloads in the form of the documentation, signed for real
 * with HMAC-SHA256. Several apps (one per GitHub account, A680): a call as an app needs its JSON web token, signed with
 * the key of that app (checked against it), and lists or gets tokens only for the installations of that app (another one
 * is 404, as at GitHub). `issued` names the tokens it handed out with installation and app.
 */
final class FakeGitHub
{
    public const API = 'https://api.github.com';

    /** @var list<string> */
    public array $tokens = [];

    /** @var array<string, int> token → installation ID */
    private array $issuedFor = [];

    /** @var list<array{token: string, installation: int, app_id: int}> the tokens it handed out, and to which app */
    public array $issued = [];

    /** @var array<int, list<array<string, mixed>>> installation ID → repos */
    public array $repositories = [];

    /** @var list<array<string, mixed>> */
    public array $installations = [];

    /** @var array<string, list<array<string, mixed>>> `owner/name:branch` → rules */
    public array $rules = [];

    /** @var array<string, int> path pattern → status GitHub refuses with */
    public array $refuse = [];

    /** @var list<string> path patterns GitHub does not answer in time (the client gives up: a ConnectionException) */
    public array $silent = [];

    /** @var array<string, int|float|null> path → the timeout werkbuch gave its last call, in seconds */
    public array $timeouts = [];

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

    /** @var array<string, string> branch → head commit as GET /git/ref/heads/{branch} answers it (others are 404) */
    public array $branches = ['main' => 'ba5e000000000000000000000000000000000001'];

    /** @var list<array{branch: string, sha: string}> the branches werkbuch created */
    public array $createdBranches = [];

    /** @var list<array{number: int, head: string, base: string, title: string, body: string, draft: bool}> the PRs werkbuch opened */
    public array $openedPulls = [];

    /** Whether a new PR has no commit its base lacks (GitHub refuses it with 422). */
    public bool $nothingToCompare = false;

    /** @var list<array{number: int, base: string}> the PRs werkbuch sent to another base */
    public array $retargets = [];

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

    /** @var array<string, list<array<string, mixed>>> the workflow runs of a commit as GET /actions/runs?head_sha= lists them */
    public array $workflowRuns = [];

    /** @var array<string, list<array<string, mixed>>> the commit statuses of a commit as GET /commits/{sha}/status lists them */
    public array $statuses = [];

    /**
     * The app of `feldwerk`, its installation and one repo `feldwerk/website` (default branch `main`), and the fake.
     */
    public static function connected(): self
    {
        $fake = new self;
        $app = GitHubApp::factory()->create();
        $installation = GitHubInstallation::factory()->create(['github_app_id' => $app->id, 'installation_id' => 55_000_001]);
        GitHubRepository::factory()->create(['installation_id' => $installation->id, 'github_id' => 700_000_001, 'full_name' => 'feldwerk/website', 'html_url' => 'https://github.com/feldwerk/website']);

        $fake->installations = [self::installationJson(55_000_001)];
        $fake->repositories = [55_000_001 => [self::repositoryJson(700_000_001, 'feldwerk/website')]];
        $fake->fake();

        return $fake;
    }

    /**
     * A second app, of the GitHub account `feldwerk-labs`, its installation 55 000 002 and the repo `feldwerk-labs/app`
     * (A680).
     */
    public function secondApp(): GitHubApp
    {
        $app = GitHubApp::factory()->account('feldwerk-labs')->create();
        $installation = GitHubInstallation::factory()->create(['github_app_id' => $app->id, 'installation_id' => 55_000_002, 'account_login' => 'feldwerk-labs']);
        GitHubRepository::factory()->create(['installation_id' => $installation->id, 'github_id' => 700_000_002, 'full_name' => 'feldwerk-labs/app', 'html_url' => 'https://github.com/feldwerk-labs/app']);

        $this->installations[] = self::installationJson(55_000_002, 'feldwerk-labs', null, $app->app_id);
        $this->repositories[55_000_002] = [self::repositoryJson(700_000_002, 'feldwerk-labs/app')];

        return $app;
    }

    /** A project with the repo `feldwerk/website` on `main`. */
    public static function link(Project $project, string $fullName = 'feldwerk/website', string $branch = 'main'): ProjectRepository
    {
        $repository = GitHubRepository::query()->where('full_name', $fullName)->firstOrFail();

        return ProjectRepository::factory()->create(['project_id' => $project->id, 'repository_id' => $repository->id, 'base_branch' => $branch]);
    }

    public function fake(): self
    {
        Http::fake(function (Request $request, array $options) {
            $this->timeouts[(string) parse_url($request->url(), PHP_URL_PATH)] = $options['timeout'] ?? null;

            return $this->answer($request);
        });

        return $this;
    }

    private function answer(Request $request): mixed
    {
        if ($this->meanwhile !== null) {
            ($this->meanwhile)($request);
        }

        $path = (string) parse_url($request->url(), PHP_URL_PATH);
        // like GitHub (WEBU-34): a JSON array as the body of a write is 422, an empty one too
        if ($request->method() !== 'GET' && str_starts_with(ltrim($request->body()), '[')) {
            return Http::response(['message' => 'Invalid request.', 'errors' => ["For 'links/0/schema', [] is not a null or object."]], 422);
        }

        foreach ($this->silent as $pattern) {
            if (Str::is($pattern, $path)) {
                throw new ConnectionException('cURL error 28: Operation timed out');
            }
        }

        foreach ($this->refuse as $pattern => $status) {
            if (Str::is($pattern, $path)) {
                return Http::response(['message' => 'Refused by the fake', 'documentation_url' => 'https://docs.github.com/rest'], $status);
            }
        }

        $page = (int) ($request->data()['page'] ?? 1);

        return match (true) {
            Str::is('/app-manifests/*/conversions', $path) => Http::response($this->conversion(), 201),
            $path === '/app/installations' => $this->asApp($request, fn (int $app) => Http::response($page === 1 ? array_values(array_filter($this->installations, fn (array $installation) => $installation['app_id'] === $app)) : [], 200)),
            Str::is('/app/installations/*/access_tokens', $path) => $this->asApp($request, fn (int $app) => $this->ofApp((int) explode('/', $path)[3], $app)
                ? Http::response($this->token($request, $app), 201)
                : Http::response(['message' => 'Not Found'], 404)),
            $path === '/installation/repositories' => Http::response($this->repositoriesFor($request), 200),
            Str::is('/repos/*/*/rules/branches/*', $path) => Http::response($this->rulesFor($path), 200),
            Str::is('/repos/*/*/issues/*/comments', $path) && $request->method() === 'POST' => Http::response($this->commentAnswer ?? $this->comment($path, $request), 201),
            Str::is('/repos/*/*/issues/comments/*', $path) && $request->method() === 'PATCH' => $this->editComment($path, $request),
            Str::is('/repos/*/*/pulls/*/merge', $path) && $request->method() === 'PUT' => $this->merge($path, $request),
            Str::is('/repos/*/*/pulls/*/reviews', $path) && $request->method() === 'POST' => $this->review($path, $request),
            Str::is('/repos/*/*/pulls/*/reviews', $path) && $request->method() === 'GET' => Http::response($page === 1 ? array_values(array_map(fn (array $review) => ['body' => $review['body']], $this->reviews)) : [], 200),
            Str::is('/repos/*/*/issues/*/comments', $path) && $request->method() === 'GET' => Http::response($page === 1 ? array_values(array_map(fn (array $comment) => ['body' => $comment['body']], $this->comments)) : [], 200),
            Str::is('/repos/*/*/commits/*/check-runs', $path) => $this->checkRunsOf(explode('/', $path)[5], $page),
            Str::is('/repos/*/*/actions/runs', $path) => Http::response(['total_count' => count($this->workflowRuns[(string) ($request->data()['head_sha'] ?? '')] ?? []),
                'workflow_runs' => $page === 1 ? ($this->workflowRuns[(string) ($request->data()['head_sha'] ?? '')] ?? []) : []], 200),
            Str::is('/repos/*/*/commits/*/status', $path) => Http::response(['state' => 'pending', 'total_count' => count($this->statuses[explode('/', $path)[5]] ?? []),
                'statuses' => $page === 1 ? ($this->statuses[explode('/', $path)[5]] ?? []) : []], 200),
            Str::is('/repos/*/*/pulls/*', $path) && $request->method() === 'PATCH' => $this->retarget($path, $request),
            Str::is('/repos/*/*/pulls/*', $path) && $request->method() === 'GET' => $this->pull((int) last(explode('/', $path))),
            $path === '/graphql' => $this->graphql($request),
            Str::is('/repos/*/*/git/refs/heads/*', $path) && $request->method() === 'DELETE' => $this->deleteBranch($path),
            Str::is('/repos/*/*/git/ref/heads/*', $path) && $request->method() === 'GET' => $this->branch($path),
            Str::is('/repos/*/*/git/refs', $path) && $request->method() === 'POST' => $this->createBranch($request),
            Str::is('/repos/*/*/pulls', $path) && $request->method() === 'POST' => $this->openPull($request),
            Str::is('/repos/*/*/pulls', $path) && $request->method() === 'GET' => Http::response($this->openPullsOf((string) ($request->data()['head'] ?? '')), 200),
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
            'permissions' => ['contents' => 'write', 'pull_requests' => 'write', 'checks' => 'read', 'actions' => 'read', 'statuses' => 'read', 'metadata' => 'read'],
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

    private function branch(string $path): mixed
    {
        $branch = rawurldecode(implode('/', array_slice(explode('/', $path), 7)));

        return isset($this->branches[$branch]) ? Http::response(['ref' => "refs/heads/{$branch}", 'object' => ['sha' => $this->branches[$branch], 'type' => 'commit']], 200)
            : Http::response(['message' => 'Not Found'], 404);
    }

    private function createBranch(Request $request): mixed
    {
        $branch = Str::after((string) ($request->data()['ref'] ?? ''), 'refs/heads/');
        if (isset($this->branches[$branch])) {
            return Http::response(['message' => 'Reference already exists'], 422);
        }
        $this->branches[$branch] = (string) ($request->data()['sha'] ?? '');
        $this->createdBranches[] = ['branch' => $branch, 'sha' => $this->branches[$branch]];

        return Http::response(['ref' => "refs/heads/{$branch}", 'object' => ['sha' => $this->branches[$branch]]], 201);
    }

    private function openPull(Request $request): mixed
    {
        $data = $request->data();
        // like GitHub: no PR without a commit the base lacks, and one open PR of a head at a time
        if ($this->nothingToCompare || $this->openPullsOf('feldwerk:'.$data['head']) !== []) {
            return Http::response(['message' => 'Validation Failed'], 422);
        }
        $number = 100 + count($this->openedPulls);
        $this->openedPulls[] = ['number' => $number, 'head' => (string) $data['head'], 'base' => (string) $data['base'], 'title' => (string) $data['title'], 'body' => (string) $data['body'], 'draft' => (bool) $data['draft']];
        $sha = $this->branches[(string) $data['head']] ?? str_repeat('e', 40);
        $this->pulls[$number] = ['draft' => (bool) $data['draft'], 'head' => ['sha' => $sha, 'ref' => $data['head']]];

        return Http::response(['number' => $number, 'node_id' => 'PR_fake'.$number, 'draft' => (bool) $data['draft'], 'head' => ['sha' => $sha, 'ref' => $data['head']]], 201);
    }

    /**
     * The open PRs of a head (`owner:branch`) as GET /pulls?head= lists them.
     *
     * @return list<array<string, mixed>>
     */
    private function openPullsOf(string $head): array
    {
        $open = array_filter($this->pulls, fn (array $pr) => ($pr['state'] ?? 'open') === 'open' && 'feldwerk:'.($pr['head']['ref'] ?? '') === $head);

        return array_map(fn (int $number) => ['number' => $number], array_keys($open));
    }

    private function retarget(string $path, Request $request): mixed
    {
        $number = (int) last(explode('/', $path));
        $base = (string) ($request->data()['base'] ?? '');
        $this->retargets[] = ['number' => $number, 'base' => $base];
        $this->pulls[$number] = [...$this->pulls[$number] ?? [], 'base' => ['ref' => $base], 'mergeable' => null];

        return Http::response(['number' => $number, 'base' => ['ref' => $base]], 200);
    }

    private function deleteBranch(string $path): mixed
    {
        $this->deletedBranches[] = rawurldecode(implode('/', array_slice(explode('/', $path), 7)));

        return Http::response(null, 204);
    }

    /**
     * Answers a call as an app: its JSON web token has to be signed with the key of a connected app (the `iss`), else
     * 401 as at GitHub.
     *
     * @param  Closure(int): mixed  $answer  gets the ID of the app
     */
    private function asApp(Request $request, Closure $answer): mixed
    {
        $parts = explode('.', str_replace('Bearer ', '', $request->header('Authorization')[0] ?? ''));
        $claims = count($parts) === 3 ? json_decode((string) base64_decode(strtr($parts[1], '-_', '+/')), true) : null;
        $app = is_array($claims) && is_numeric($claims['iss'] ?? null) ? GitHubApp::query()->where('app_id', (int) $claims['iss'])->first() : null;
        $private = $app === null ? false : openssl_pkey_get_private($app->private_key);
        $details = $private === false ? false : openssl_pkey_get_details($private);
        $key = $details === false ? false : openssl_pkey_get_public($details['key']);
        $signature = base64_decode(strtr($parts[2] ?? '', '-_', '+/'));

        if ($app === null || $key === false || openssl_verify($parts[0].'.'.$parts[1], $signature, $key, OPENSSL_ALGO_SHA256) !== 1) {
            return Http::response(['message' => 'A JSON web token could not be decoded'], 401);
        }

        return $answer($app->app_id);
    }

    /** Whether the installation belongs to the app (installations of other apps are not known to it). */
    private function ofApp(int $installation, int $app): bool
    {
        foreach ($this->installations as $known) {
            if ($known['id'] === $installation) {
                return $known['app_id'] === $app;
            }
        }

        // an installation the test did not list belongs to the app of feldwerk
        return $app === GitHubAppFactory::DEFAULT_APP_ID;
    }

    /** @return array<string, mixed> */
    private function token(Request $request, int $app): array
    {
        // the form GitHub gives since 2026 (A730): `ghs_<app>_<JWT>`, about 520 characters with two dots
        $token = "ghs_{$app}_eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.".Str::random(380).'.'.Str::random(86);
        $this->tokens[] = $token;
        $installation = (int) explode('/', (string) parse_url($request->url(), PHP_URL_PATH))[3];
        $this->issuedFor[$token] = $installation;
        $this->issued[] = ['token' => $token, 'installation' => $installation, 'app_id' => $app];
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
    public static function installationJson(int $id, string $login = 'feldwerk', ?string $suspended = null, int $appId = GitHubAppFactory::DEFAULT_APP_ID): array
    {
        return [
            'id' => $id, 'client_id' => 'Iv23liFake', 'app_id' => $appId, 'app_slug' => strtolower($login).'-werkbuch', 'target_id' => 9_001,
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
     * Posts a delivery of an app to the webhook (default: the first app), signed with the secret given (default: the
     * app's); `X-GitHub-Hook-Installation-Target-ID` names the app (`$target` another value, `false` none).
     *
     * @param  array<string, mixed>  $payload
     */
    public static function deliver(TestCase $test, string $event, array $payload, ?string $delivery = null, ?string $secret = null, ?string $signature = null, ?GitHubApp $app = null, string|false|null $target = null): TestResponse
    {
        $body = (string) json_encode($payload, JSON_UNESCAPED_SLASHES);
        $app ??= GitHubApp::query()->orderBy('id')->firstOrFail();
        $secret ??= $app->webhook_secret;
        $target ??= (string) $app->app_id;

        return $test->call('POST', '/github/webhook', [], [], [], [...($target === false ? [] : ['HTTP_X_GITHUB_HOOK_INSTALLATION_TARGET_ID' => $target]),
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
