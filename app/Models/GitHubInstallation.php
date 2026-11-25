<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Database\Factories\GitHubInstallationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * An installation of an app on its GitHub account (spec 10.2, A680: a private app installs only there). Uninstalled at GitHub it keeps its row with `removed_at`
 * (its repos are removed too, A512); suspended it gives no tokens.
 *
 * @property string $id
 * @property string $github_app_id
 * @property int $installation_id
 * @property string $account_login
 * @property string $account_type
 * @property string $repository_selection
 * @property CarbonImmutable|null $suspended_at
 * @property CarbonImmutable|null $removed_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read GitHubApp $app
 */
#[Fillable(['github_app_id', 'installation_id', 'account_login', 'account_type', 'repository_selection', 'suspended_at', 'removed_at'])]
final class GitHubInstallation extends Model
{
    /** @use HasFactory<GitHubInstallationFactory> */
    use HasFactory, HasUlids;

    protected $table = 'github_installations';

    protected function casts(): array
    {
        return ['installation_id' => 'integer', 'suspended_at' => 'immutable_datetime', 'removed_at' => 'immutable_datetime'];
    }

    /** @return BelongsTo<GitHubApp, $this> */
    public function app(): BelongsTo
    {
        return $this->belongsTo(GitHubApp::class, 'github_app_id');
    }

    /** @return HasMany<GitHubRepository, $this> */
    public function repositories(): HasMany
    {
        return $this->hasMany(GitHubRepository::class, 'installation_id');
    }

    /** Whether it can give tokens: installed and not suspended. */
    public function usable(): bool
    {
        return $this->removed_at === null && $this->suspended_at === null;
    }
}
