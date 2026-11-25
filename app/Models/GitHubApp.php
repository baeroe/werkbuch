<?php

namespace App\Models;

use Database\Factories\GitHubAppFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A GitHub app of the instance (spec 4, 11.3), registered through the manifest flow: one private app per GitHub account
 * (`owner_login`, unique, A680), because a private app installs only on the account it belongs to. Its private key and
 * webhook secret are stored encrypted with APP_KEY and never leave the model by toArray() or toJson() (A510); the client
 * secret of the conversion is not kept (werkbuch signs nobody in with GitHub).
 *
 * @property string $id
 * @property int $app_id
 * @property string $slug
 * @property string $name
 * @property string|null $client_id
 * @property string $owner_login
 * @property string $owner_type
 * @property string $html_url
 * @property string $private_key
 * @property string $webhook_secret
 * @property array<string, string> $permissions
 * @property list<string> $events
 * @property string $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Collection<int, GitHubInstallation> $installations
 */
#[Fillable(['app_id', 'slug', 'name', 'client_id', 'owner_login', 'owner_type', 'html_url', 'private_key', 'webhook_secret', 'permissions', 'events', 'created_by'])]
#[Hidden(['private_key', 'webhook_secret'])]
final class GitHubApp extends Model
{
    /** @use HasFactory<GitHubAppFactory> */
    use HasFactory, HasUlids;

    protected $table = 'github_apps';

    protected function casts(): array
    {
        return [
            'app_id' => 'integer',
            'private_key' => 'encrypted',
            'webhook_secret' => 'encrypted',
            'permissions' => 'array',
            'events' => 'array',
        ];
    }

    /** @return HasMany<GitHubInstallation, $this> */
    public function installations(): HasMany
    {
        return $this->hasMany(GitHubInstallation::class, 'github_app_id');
    }

    /** The app of a repo at GitHub (by its ID there): the one whose installation reaches it, null for none. */
    public static function ofRepository(int $githubId): ?self
    {
        return self::query()->whereHas('installations.repositories', fn ($query) => $query->where('github_id', $githubId))->first();
    }

    /** The login of the app's bot account at GitHub, the sender of what its tokens do (`<slug>[bot]`). */
    public function botLogin(): string
    {
        return $this->slug.'[bot]';
    }
}
