<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Database\Factories\ProjectRepositoryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * The repo of a project (spec 4 „Repo und Projekt“: 1:1, unique on both sides) with its base branch and whether a
 * ruleset protects it (only a hint, spec 10.2). The `guard_*` columns are the guard against an unauthorized merge
 * (spec 11.3): a push of the app to the base branch no merge of werkbuch explains; while it is set, every strand of the
 * project pauses and no run of it starts until a project admin confirms.
 *
 * @property string $id
 * @property string $project_id
 * @property string $repository_id
 * @property string $base_branch
 * @property bool|null $protected
 * @property CarbonImmutable|null $protected_checked_at
 * @property CarbonImmutable|null $guard_detected_at
 * @property string|null $guard_sha
 * @property string|null $guard_branch
 * @property list<array{run_id: string, item_id: string|null, bot_id: string}>|null $guard_runs
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Project $project
 * @property-read GitHubRepository $repository
 */
#[Fillable(['project_id', 'repository_id', 'base_branch', 'protected', 'protected_checked_at', 'guard_detected_at', 'guard_sha', 'guard_branch', 'guard_runs'])]
final class ProjectRepository extends Model
{
    /** @use HasFactory<ProjectRepositoryFactory> */
    use HasFactory, HasUlids;

    /** The guard columns, emptied together. */
    public const GUARD = ['guard_detected_at' => null, 'guard_sha' => null, 'guard_branch' => null, 'guard_runs' => null];

    protected function casts(): array
    {
        return ['protected' => 'boolean', 'protected_checked_at' => 'immutable_datetime', 'guard_detected_at' => 'immutable_datetime', 'guard_runs' => 'array'];
    }

    /** @return BelongsTo<Project, $this> */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** @return BelongsTo<GitHubRepository, $this> */
    public function repository(): BelongsTo
    {
        return $this->belongsTo(GitHubRepository::class, 'repository_id');
    }

    /** Whether the guard holds the project. */
    public function guarded(): bool
    {
        return $this->guard_detected_at !== null;
    }
}
