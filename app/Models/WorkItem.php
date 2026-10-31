<?php

namespace App\Models;

use App\Access\Visibility;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\ItemKey;
use App\Domain\WorkItems\Priority;
use Database\Factories\WorkItemFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * A work item of a project (spec 4.4). Its key (`WEB-12`) is never stored: the current identifier of the project and
 * the number (P20). `rank` orders the items of a project and compares byte by byte (`ascii_bin`, P4).
 *
 * @property string $id
 * @property string $project_id
 * @property int $number
 * @property string $type_id
 * @property string $title
 * @property array<string, mixed>|null $description
 * @property string|null $description_text
 * @property int $description_version
 * @property string $state_id
 * @property string|null $resolution_id
 * @property string|null $assignee_id
 * @property Priority $priority
 * @property Carbon|null $start_date
 * @property Carbon|null $due_date
 * @property string|null $parent_id
 * @property string $rank
 * @property string $created_by
 * @property Carbon|null $started_at
 * @property Carbon|null $closed_at
 * @property Carbon|null $archived_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read string $key
 * @property-read int $children_total only with `withComputed()`
 * @property-read int $children_done only with `withComputed()`
 * @property-read bool $is_blocked only with `withComputed()`
 * @property-read bool $is_blocking only with `withComputed()`
 * @property-read Project $project
 * @property-read WorkItemType $type
 */
#[Fillable([
    'project_id', 'number', 'type_id', 'title', 'description', 'description_text', 'description_version', 'state_id',
    'resolution_id', 'assignee_id', 'priority', 'start_date', 'due_date', 'parent_id', 'rank', 'created_by',
    'started_at', 'closed_at', 'archived_at',
])]
final class WorkItem extends Model
{
    /** @use HasFactory<WorkItemFactory> */
    use HasFactory, HasUlids;

    /**
     * Set by findByReference(), never stored: the item was asked for by a former identifier of its project, so a caller
     * with an address redirects to the current key (as P32 for projects).
     */
    public bool $resolved_by_former_identifier = false;

    /**
     * Set by loadForResource(), never stored: whether the reader it was loaded for watches the item.
     */
    public bool $subscribed = false;

    /**
     * Set by GetWorkItem, never stored: what WorkItemResource embeds besides the item (`children`, `type`, `workflow`),
     * loaded there already.
     *
     * @var list<string>
     */
    public array $includes = [];

    /**
     * Loads everything WorkItemResource reads, for one item or a list, with a fixed number of queries (none per item):
     * `project`, `parent.project`, `labels`, `values.property`, the computed columns of withComputed() (one query, set
     * on the models as they are, never written back) and `subscribed` for the reader (K5). The resource then asks the
     * database nothing.
     *
     * @param  EloquentCollection<int, self>|self  $items
     */
    public static function loadForResource(EloquentCollection|self $items, User $reader): void
    {
        $items = $items instanceof self ? $items->newCollection([$items]) : $items;
        $items->load(['project', 'parent.project', 'labels:labels.id', 'values.property']);
        $ids = $items->modelKeys();

        $computed = self::query()->select('id')->withComputed()->whereKey($ids)->get()->keyBy('id');
        $watched = WorkItemSubscriber::query()->whereIn('work_item_id', $ids)->where('user_id', $reader->id)
            ->whereNull('unsubscribed_at')->pluck('work_item_id')->all();

        foreach ($items as $item) {
            $row = $computed->get($item->id);
            foreach (['children_total', 'children_done', 'is_blocked', 'is_blocking'] as $column) {
                $item->setAttribute($column, $row?->getAttribute($column));
                $item->syncOriginalAttribute($column);
            }
            $item->subscribed = in_array($item->id, $watched, true);
        }
    }

    /**
     * The item a reference names: its ULID (in any case) or its key (`WEB-12`, `web-12`, also with a former identifier
     * of the project). It does not check who may see the item.
     */
    public static function findByReference(string $ref): ?self
    {
        if (Str::isUlid($ref)) {
            return self::query()->find(strtolower($ref));
        }

        $key = ItemKey::parse($ref);
        if ($key === null) {
            return null;
        }

        $project = Project::query()->where('identifier', $key['identifier'])->first();
        $former = $project === null;
        $project ??= ProjectIdentifier::query()->where('identifier', $key['identifier'])->first()?->project;

        if ($project === null) {
            return null;
        }

        $item = self::query()->where('project_id', $project->id)->where('number', $key['number'])->first();
        if ($item !== null) {
            $item->setRelation('project', $project);
            $item->resolved_by_former_identifier = $former;
        }

        return $item;
    }

    /**
     * Only the items of the projects the account sees (App\Access\Visibility, the one access scope).
     *
     * @param  Builder<self>  $query
     */
    public function scopeVisibleTo(Builder $query, User $user): void
    {
        $query->whereIn($query->qualifyColumn('project_id'), Visibility::projectIds($user));
    }

    /**
     * Adds what is computed from other rows, as subqueries: `children_total` and `children_done` (children in a
     * completed or canceled state; 0 and 0 without children), `is_blocked` (an open item blocks this open item through
     * the built-in relation type `blocks`) and `is_blocking` (this open item blocks an open item). Other relation types
     * never count.
     *
     * @param  Builder<self>  $query
     */
    public function scopeWithComputed(Builder $query): void
    {
        $children = fn () => DB::query()->from('work_items as children')->selectRaw('count(*)')->whereColumn('children.parent_id', 'work_items.id');

        $query->addSelect([
            'children_total' => $children(),
            'children_done' => $children()
                ->join('workflow_states as child_states', 'child_states.id', '=', 'children.state_id')
                ->whereIn('child_states.category', self::closedCategories()),
            'is_blocked' => self::blocks('target_id', 'source_id'),
            'is_blocking' => self::blocks('source_id', 'target_id'),
        ]);
    }

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * @return BelongsTo<WorkItemType, $this>
     */
    public function type(): BelongsTo
    {
        return $this->belongsTo(WorkItemType::class, 'type_id');
    }

    /**
     * @return BelongsTo<WorkflowState, $this>
     */
    public function state(): BelongsTo
    {
        return $this->belongsTo(WorkflowState::class, 'state_id');
    }

    /**
     * @return BelongsTo<Resolution, $this>
     */
    public function resolution(): BelongsTo
    {
        return $this->belongsTo(Resolution::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * @return BelongsTo<self, $this>
     */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    /**
     * @return HasMany<self, $this>
     */
    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('rank')->orderBy('id');
    }

    /**
     * The labels of the item, in catalog order (the order of their creation).
     *
     * @return BelongsToMany<Label, $this, WorkItemLabel>
     */
    public function labels(): BelongsToMany
    {
        return $this->belongsToMany(Label::class, 'work_item_labels', 'work_item_id', 'label_id')
            ->using(WorkItemLabel::class)->withTimestamps()->orderBy('labels.id');
    }

    /**
     * The values of the properties, one row each (a multiple choice as several rows in `position` order).
     *
     * @return HasMany<WorkItemValue, $this>
     */
    public function values(): HasMany
    {
        return $this->hasMany(WorkItemValue::class)->orderBy('property_id')->orderBy('position');
    }

    /**
     * The relations that start at this item.
     *
     * @return HasMany<WorkItemRelation, $this>
     */
    public function outgoing(): HasMany
    {
        return $this->hasMany(WorkItemRelation::class, 'source_id');
    }

    /**
     * The relations that end at this item.
     *
     * @return HasMany<WorkItemRelation, $this>
     */
    public function incoming(): HasMany
    {
        return $this->hasMany(WorkItemRelation::class, 'target_id');
    }

    /**
     * @return HasMany<WorkItemSubscriber, $this>
     */
    public function subscriptions(): HasMany
    {
        return $this->hasMany(WorkItemSubscriber::class);
    }

    /**
     * @return Attribute<string, never>
     */
    protected function key(): Attribute
    {
        return Attribute::get($this->spellKey(...));
    }

    private function spellKey(): string
    {
        return "{$this->project->identifier}-{$this->number}";
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'number' => 'int',
            'priority' => Priority::class,
            'description' => 'array',
            'description_version' => 'int',
            'start_date' => 'date:Y-m-d',
            'due_date' => 'date:Y-m-d',
            'started_at' => 'datetime',
            'closed_at' => 'datetime',
            'archived_at' => 'datetime',
            'children_total' => 'int',
            'children_done' => 'int',
            'is_blocked' => 'bool',
            'is_blocking' => 'bool',
        ];
    }

    /**
     * Whether an open item at `$self` of a `blocks` relation (this item, open as well) has an open item at the other end.
     */
    private static function blocks(string $self, string $other): QueryBuilder
    {
        $open = fn (QueryBuilder $states) => $states->select('id')->from('workflow_states')->whereNotIn('category', self::closedCategories());

        return DB::query()->from('work_item_relations as blocks')
            ->selectRaw('count(*) > 0')
            ->join('relation_types as block_types', 'block_types.id', '=', 'blocks.type_id')
            ->join('work_items as other_end', 'other_end.id', '=', "blocks.{$other}")
            ->where('block_types.built_in', 'blocks')
            ->whereColumn("blocks.{$self}", 'work_items.id')
            ->whereIn('other_end.state_id', $open)
            ->whereIn('work_items.state_id', $open);
    }

    /**
     * @return list<string>
     */
    private static function closedCategories(): array
    {
        return array_values(array_map(
            fn (StateCategory $category) => $category->value,
            array_filter(StateCategory::cases(), fn (StateCategory $category) => $category->isClosed()),
        ));
    }
}
