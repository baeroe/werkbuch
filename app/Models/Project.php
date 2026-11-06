<?php

namespace App\Models;

use App\Access\Visibility;
use App\Enums\ProjectVisibility;
use App\Rules\ImageDataUrl;
use Database\Factories\ProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Laravel\Scout\Searchable;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;

/**
 * A project (spec 4.4). Its picture is the media collection `image`; who sees it follows the visibility of the project.
 *
 * @property string $id
 * @property string $identifier
 * @property string $name
 * @property string $description
 * @property string $lead_id
 * @property ProjectVisibility $visibility
 * @property string $workflow_id
 * @property string $default_type_id
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
final class Project extends Model implements HasMedia
{
    /** @use HasFactory<ProjectFactory> */
    use HasFactory, HasUlids, InteractsWithMedia, Searchable;

    /**
     * Set by App\Actions\Projects\GetProject, never stored: the project was asked for by a former identifier, so a
     * caller with an address redirects to the current one (P32).
     */
    public bool $resolved_by_former_identifier = false;

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
     * The search document (index `projects`): the identifier and the former ones (they keep resolving), name and
     * description; who may see the project is filtered when searching (P2). Reads `identifiers` (loaded at once by
     * makeAllSearchableUsing()).
     *
     * @return array{id: string, identifier: string, former_identifiers: list<string>, name: string, description: string, archived: bool}
     */
    public function toSearchableArray(): array
    {
        return [
            'id' => $this->id,
            'identifier' => $this->identifier,
            'former_identifiers' => array_values($this->identifiers->map(fn (ProjectIdentifier $former) => $former->identifier)->sort()->all()),
            'name' => $this->name,
            'description' => $this->description,
            'archived' => $this->archived_at !== null,
        ];
    }

    /**
     * A project being deleted is gone for everyone at once, from the index as well.
     */
    public function shouldBeSearchable(): bool
    {
        return $this->deleting_at === null;
    }

    /**
     * What toSearchableArray() reads, loaded with the query of a rebuild (makeAllSearchableQuery()).
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    protected function makeAllSearchableUsing(Builder $query): Builder
    {
        return $query->with('identifiers:id,project_id,identifier');
    }

    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('image')->singleFile()->acceptsMimeTypes(ImageDataUrl::MIME_TYPES);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function lead(): BelongsTo
    {
        return $this->belongsTo(User::class, 'lead_id');
    }

    /**
     * The workflow of the project.
     *
     * @return BelongsTo<Workflow, $this>
     */
    public function workflow(): BelongsTo
    {
        return $this->belongsTo(Workflow::class);
    }

    /**
     * The work item types switched on in the project, in catalog order (the order of their creation).
     *
     * @return BelongsToMany<WorkItemType, $this, ProjectType>
     */
    public function types(): BelongsToMany
    {
        return $this->belongsToMany(WorkItemType::class, 'project_types', 'project_id', 'type_id')
            ->using(ProjectType::class)->withTimestamps()->orderBy('work_item_types.id');
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
     * @return HasMany<WorkItem, $this>
     */
    public function workItems(): HasMany
    {
        return $this->hasMany(WorkItem::class);
    }

    /**
     * @return HasMany<ProjectMember, $this>
     */
    public function memberships(): HasMany
    {
        return $this->hasMany(ProjectMember::class);
    }

    /**
     * The memberships in the order they joined, each with this project: what `include=members` of the project list
     * loads (K13).
     *
     * @return HasMany<ProjectMember, $this>
     */
    public function members(): HasMany
    {
        return $this->hasMany(ProjectMember::class)->orderBy('project_members.id')->chaperone('project');
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
