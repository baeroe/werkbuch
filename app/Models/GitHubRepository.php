<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Database\Factories\GitHubRepositoryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Carbon;

/**
 * A repo an installation of the app reaches (spec 10.2). Taken out of the installation at GitHub it keeps its row with
 * `removed_at` (a project keeps its link, a token for it is 409 `repository_unavailable`, A512).
 *
 * @property string $id
 * @property string $installation_id
 * @property int $github_id
 * @property string $full_name
 * @property bool $private
 * @property string $default_branch
 * @property string $html_url
 * @property CarbonImmutable|null $removed_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read GitHubInstallation $installation
 * @property-read ProjectRepository|null $link
 */
#[Fillable(['installation_id', 'github_id', 'full_name', 'private', 'default_branch', 'html_url', 'removed_at'])]
final class GitHubRepository extends Model
{
    /** @use HasFactory<GitHubRepositoryFactory> */
    use HasFactory, HasUlids;

    protected $table = 'github_repositories';

    protected function casts(): array
    {
        return ['github_id' => 'integer', 'private' => 'boolean', 'removed_at' => 'immutable_datetime'];
    }

    /** @return BelongsTo<GitHubInstallation, $this> */
    public function installation(): BelongsTo
    {
        return $this->belongsTo(GitHubInstallation::class, 'installation_id');
    }

    /** @return HasOne<ProjectRepository, $this> */
    public function link(): HasOne
    {
        return $this->hasOne(ProjectRepository::class, 'repository_id');
    }

    /** The URL a runner clones over HTTPS with the installation token (spec 8.1). */
    public function cloneUrl(): string
    {
        return $this->html_url.'.git';
    }
}
