<?php

namespace App\Actions\GitHub;

use App\Access\Authorize;
use App\Domain\GitHub\BranchRules;
use App\Exceptions\Problem;
use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\Models\GitHubApp;
use App\Models\GitHubInstallation;
use App\Models\GitHubRepository;
use App\Models\Organization;
use App\Models\ProjectRepository;
use App\Support\Actor;
use App\Support\CatalogLock;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Reads the installations of the apps and the repos they reach from GitHub (spec 10.2): after the installation (GitHub
 * sends the person to `/github/setup`) and by hand (org admins) every app, one after the other; on `installation` and
 * `installation_repositories` webhooks the app that sent them (A680: one app per GitHub account, each with its own
 * installations). For every linked repo it asks again whether a ruleset protects the base branch (only a hint, A513). GitHub
 * first, without a lock, then one transaction under the lock of the organization writes it: an installation or repo
 * gone at GitHub keeps its row with `removed_at` (A512; a project keeps its link), one that comes back loses it. No
 * event: the state of GitHub is bookkeeping. Answers the connection as GetGitHub does.
 */
final class SyncGitHub
{
    use AsAction;

    /**
     * Every app (or only `$only`), one after the other: an app GitHub does not answer for holds up none of the others
     * (A686); they are read, and the 503 names the accounts that failed.
     *
     * @return array<string, mixed>
     *
     * @throws Problem 403, 409 `github_not_connected`, 503 `github_unavailable`
     */
    public function handle(Actor $actor, ?GitHubApp $only = null): array
    {
        Authorize::check($actor, 'manageGitHub', Organization::class);

        $apps = $only !== null ? collect([$only]) : GitHubApp::query()->orderBy('owner_login')->orderBy('id')->get();
        if ($apps->isEmpty()) {
            throw Problem::conflict('github_not_connected');
        }

        $failed = [];
        foreach ($apps as $app) {
            try {
                self::pull($app);
            } catch (GitHubUnavailable $e) {
                report($e);
                $failed[] = $app->owner_login;
            }
        }
        if ($failed !== []) {
            throw Problem::unavailable('github_unavailable', __('problem.detail.github_sync_failed', ['logins' => implode(', ', $failed)]));
        }

        return GetGitHub::run($actor);
    }

    /**
     * Reads GitHub for one app and writes what it says about its installations; those of other apps stay as they are.
     *
     * @throws GitHubUnavailable
     */
    public static function pull(GitHubApp $app): void
    {
        $installations = [];
        foreach (GitHubApi::installations($app) as $installation) {
            $id = $installation['id'] ?? null;
            $account = is_array($installation['account'] ?? null) ? $installation['account'] : [];
            if (! is_int($id)) {
                continue;
            }

            $suspended = is_string($installation['suspended_at'] ?? null) ? CarbonImmutable::parse($installation['suspended_at']) : null;
            $row = [
                'installation_id' => $id,
                'account_login' => is_string($account['login'] ?? null) ? $account['login'] : '',
                'account_type' => is_string($account['type'] ?? null) ? $account['type'] : '',
                'repository_selection' => is_string($installation['repository_selection'] ?? null) ? $installation['repository_selection'] : 'selected',
                'suspended_at' => $suspended,
            ];

            // a suspended installation gives no token: its repos stay as they were
            $repositories = null;
            $protection = [];
            if ($suspended === null) {
                $token = GitHubApi::accessToken($app, $id, null, ['metadata' => 'read'])['token'];
                $repositories = GitHubApi::repositories($token);
                $protection = self::protection($token, $repositories);
            }

            $installations[$id] = ['row' => $row, 'repositories' => $repositories, 'protection' => $protection];
        }

        DB::transaction(function () use ($app, $installations): void {
            CatalogLock::take();
            // gone meanwhile (disconnected): what GitHub said belongs to nobody
            if (GitHubApp::query()->whereKey($app->id)->doesntExist()) {
                return;
            }

            $app->installations()->whereNotIn('installation_id', array_keys($installations) ?: [0])->whereNull('removed_at')
                ->each(function (GitHubInstallation $gone): void {
                    $gone->forceFill(['removed_at' => now()])->save();
                    $gone->repositories()->whereNull('removed_at')->update(['removed_at' => now(), 'updated_at' => now()]);
                });

            foreach ($installations as $id => $installation) {
                $row = GitHubInstallation::query()->updateOrCreate(['installation_id' => $id], [...$installation['row'], 'github_app_id' => $app->id, 'removed_at' => null]);
                if ($installation['repositories'] !== null) {
                    self::repositories($row, $installation['repositories']);
                }
                foreach ($installation['protection'] as $linkId => $protected) {
                    ProjectRepository::query()->whereKey($linkId)->update(['protected' => $protected, 'protected_checked_at' => now(), 'updated_at' => now()]);
                }
            }
        }, 3);
    }

    /**
     * Whether a ruleset protects the base branch of each linked repo among these (link ID → protected, null when GitHub
     * did not say).
     *
     * @param  list<array<string, mixed>>  $repositories
     * @return array<string, bool|null>
     */
    private static function protection(string $token, array $repositories): array
    {
        $ids = array_values(array_filter(array_map(fn (array $repo) => $repo['id'] ?? null, $repositories), 'is_int'));
        $links = ProjectRepository::query()->with('repository')
            ->whereHas('repository', fn ($query) => $query->whereIn('github_id', $ids ?: [0]))->get();

        $protection = [];
        foreach ($links as $link) {
            $protection[$link->id] = self::protects($token, $link->repository->full_name, $link->base_branch);
        }

        return $protection;
    }

    /** Whether a ruleset keeps a direct push off the branch; null when GitHub does not say. */
    public static function protects(string $token, string $fullName, string $branch): ?bool
    {
        try {
            return BranchRules::protects(GitHubApi::branchRules($token, $fullName, $branch));
        } catch (GitHubUnavailable) {
            return null;
        }
    }

    /**
     * Writes the repos of an installation; the ones it no longer reaches are removed.
     *
     * @param  list<array<string, mixed>>  $repositories
     */
    private static function repositories(GitHubInstallation $installation, array $repositories): void
    {
        $seen = [];
        foreach ($repositories as $repository) {
            $id = $repository['id'] ?? null;
            $name = $repository['full_name'] ?? null;
            if (! is_int($id) || ! is_string($name)) {
                continue;
            }

            $seen[] = $id;
            GitHubRepository::query()->updateOrCreate(['github_id' => $id], [
                'installation_id' => $installation->id,
                'full_name' => $name,
                'private' => (bool) ($repository['private'] ?? true),
                'default_branch' => is_string($repository['default_branch'] ?? null) ? $repository['default_branch'] : 'main',
                'html_url' => is_string($repository['html_url'] ?? null) ? $repository['html_url'] : rtrim((string) config('werkbuch.github.web_url'), '/').'/'.$name,
                'removed_at' => null,
            ]);
        }

        $installation->repositories()->whereNotIn('github_id', $seen ?: [0])->whereNull('removed_at')
            ->update(['removed_at' => now(), 'updated_at' => now()]);
    }
}
