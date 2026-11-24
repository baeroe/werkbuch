<?php

namespace App\Actions\GitHub;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\GitHub\GitHubApi;
use App\GitHub\GitHubUnavailable;
use App\Models\GitHubApp;
use App\Models\GitHubRepository;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Support\Actor;
use App\Support\CatalogLock;
use App\Support\ProjectLock;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Gives a project its repo, or none (spec 4 „Repo und Projekt“, 10.3): one of the repos the app reaches (by its ULID or
 * `owner/name`), at most one project per repo and one repo per project (both unique in the database), and the base
 * branch (default: the default branch of the repo). Before the lock it asks GitHub whether a ruleset protects the base
 * branch (only a hint, A513; null when GitHub does not say). While the guard holds the project the repo stays (409
 * `merge_guard_open`: a project admin confirms first). `project.repository_changed` names the repo and branch, old and new.
 * The admins of the project (`project.manage`); an archived project stays changeable for them.
 */
final class LinkRepository
{
    use AsAction;

    public const FIELDS = ['repository_id', 'base_branch'];

    public const BRANCH_MAX = 255;

    /**
     * @param  array<array-key, mixed>  $input
     *
     * @throws Problem 403, 404, 409 `merge_guard_open`
     * @throws ValidationException
     */
    public function handle(Actor $actor, Project|string $project, array $input): ?ProjectRepository
    {
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;
        Authorize::check($actor, 'manageRepository', $project);

        $repository = self::repository($input['repository_id'] ?? null);
        $branch = $repository === null ? null : self::branch($input['base_branch'] ?? null, $repository);
        $protected = $repository === null ? null : self::protects($repository, (string) $branch);

        try {
            return DB::transaction(function () use ($actor, $project, $repository, $branch, $protected): ?ProjectRepository {
                CatalogLock::share();
                $locked = ProjectLock::lock($project);
                $current = ProjectRepository::query()->with('repository')->lockForUpdate()->where('project_id', $locked->id)->first();

                if ($current?->guarded()) {
                    throw Problem::conflict('merge_guard_open');
                }

                if ($repository !== null && ProjectRepository::query()->where('repository_id', $repository->id)->where('project_id', '!=', $locked->id)->exists()) {
                    throw ValidationException::withMessages(['repository_id' => __('field.repository_id.taken')]);
                }

                $before = ['repository' => $current?->repository->full_name, 'base_branch' => $current?->base_branch];
                $after = ['repository' => $repository?->full_name, 'base_branch' => $branch];
                if ($before === $after) {
                    return $current;
                }

                if ($repository === null) {
                    $current?->delete();
                    $link = null;
                } else {
                    $link = ProjectRepository::query()->updateOrCreate(['project_id' => $locked->id], [
                        'repository_id' => $repository->id, 'base_branch' => (string) $branch, 'protected' => $protected,
                        'protected_checked_at' => $protected === null ? null : now(),
                    ])->load('repository');
                }

                $changes = [];
                foreach ($after as $key => $value) {
                    if ($before[$key] !== $value) {
                        $changes[$key] = ['old' => $before[$key], 'new' => $value];
                    }
                }
                EventRecorder::record(EventType::ProjectRepositoryChanged, $actor, $locked, $locked, $changes);

                return $link;
            }, 3);
        } catch (UniqueConstraintViolationException) {
            // another project took the repo at the same moment
            throw ValidationException::withMessages(['repository_id' => __('field.repository_id.taken')]);
        }
    }

    /** The repo named by its ULID or `owner/name`, one the app still reaches; null for none. */
    private static function repository(mixed $reference): ?GitHubRepository
    {
        if ($reference === null) {
            return null;
        }

        $repository = ! is_string($reference) ? null : GitHubRepository::query()->whereNull('removed_at')
            ->where(fn ($query) => Str::isUlid(strtolower($reference))
                ? $query->whereKey(strtolower($reference))
                : $query->where('full_name', $reference))
            ->first();

        return $repository ?? throw ValidationException::withMessages(['repository_id' => __('field.repository_id.unknown')]);
    }

    /** The base branch: the one sent, else the default branch of the repo; a name git takes for a branch. */
    private static function branch(mixed $branch, GitHubRepository $repository): string
    {
        $branch = is_string($branch) ? Str::trim($branch) : $branch;
        if ($branch === null || $branch === '') {
            return $repository->default_branch;
        }

        $valid = is_string($branch) && mb_strlen($branch) <= self::BRANCH_MAX
            && preg_match('/[\x00-\x20~^:?*\[\\\\\x7f]/', $branch) !== 1
            && ! str_starts_with($branch, '-') && ! str_starts_with($branch, '/')
            && ! str_ends_with($branch, '/') && ! str_ends_with($branch, '.') && ! str_ends_with($branch, '.lock')
            && ! str_contains($branch, '..') && ! str_contains($branch, '//') && ! str_contains($branch, '@{') && ! str_contains($branch, '/.');

        return $valid ? $branch : throw ValidationException::withMessages(['base_branch' => __('field.base_branch.invalid')]);
    }

    /** Whether a ruleset protects the branch; null when GitHub cannot say (no app, installation away, no answer). */
    private static function protects(GitHubRepository $repository, string $branch): ?bool
    {
        $app = GitHubApp::current();
        $installation = $repository->installation;
        if ($app === null || ! $installation->usable()) {
            return null;
        }

        try {
            $token = GitHubApi::accessToken($app, $installation->installation_id, [$repository->github_id], ['metadata' => 'read'])['token'];
        } catch (GitHubUnavailable) {
            return null;
        }

        return SyncGitHub::protects($token, $repository->full_name, $branch);
    }
}
