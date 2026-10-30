<?php

namespace App\Models;

use App\Access\Visibility;
use App\Enums\ProjectVisibility;
use Database\Factories\ProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * @property string $id
 * @property string $identifier
 * @property string $name
 * @property string $description
 * @property string $lead_id
 * @property ProjectVisibility $visibility
 * @property string|null $workflow_id
 * @property string|null $default_type_id
 * @property int $next_number
 * @property Carbon|null $archived_at
 * @property Carbon|null $deleting_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'identifier', 'name', 'description', 'lead_id', 'visibility', 'workflow_id', 'default_type_id',
    'next_number', 'archived_at', 'deleting_at',
])]
final class Project extends Model
{
    /** @use HasFactory<ProjectFactory> */
    use HasFactory, HasUlids;

    /**
     * The project a reference names: its ULID, its identifier or a former identifier, in any case. It does not check
     * who may see the project.
     */
    public static function findByReference(string $ref): ?self
    {
        if (Str::isUlid($ref)) {
            return self::query()->find(strtolower($ref));
        }

        $identifier = strtoupper($ref);

        return self::query()->where('identifier', $identifier)->first()
            ?? self::query()->whereHas('identifiers', fn ($query) => $query->where('identifier', $identifier))->first();
    }

    /**
     * Only the projects the account sees (App\Access\Visibility, the one access scope).
     *
     * @param  Builder<self>  $query
     */
    public function scopeVisibleTo(Builder $query, User $user): void
    {
        $query->whereIn($query->qualifyColumn('id'), Visibility::projectIds($user));
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function lead(): BelongsTo
    {
        return $this->belongsTo(User::class, 'lead_id');
    }

    /**
     * Former identifiers, which keep resolving to the project.
     *
     * @return HasMany<ProjectIdentifier, $this>
     */
    public function identifiers(): HasMany
    {
        return $this->hasMany(ProjectIdentifier::class);
    }

    /**
     * @return HasMany<ProjectMember, $this>
     */
    public function memberships(): HasMany
    {
        return $this->hasMany(ProjectMember::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'visibility' => ProjectVisibility::class,
            'archived_at' => 'datetime',
            'deleting_at' => 'datetime',
        ];
    }
}
