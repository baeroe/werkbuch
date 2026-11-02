<?php

namespace App\Models;

use App\Access\Visibility;
use App\Domain\Properties\FieldType;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\ItemKey;
use App\Domain\WorkItems\Priority;
use App\RichText\Document;
use App\RichText\RichTextNames;
use App\Support\RichTextLookups;
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
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Scout\Searchable;

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
 * @property-read WorkflowState $state
 */
#[Fillable([
    'project_id', 'number', 'type_id', 'title', 'description', 'description_text', 'description_version', 'state_id',
    'resolution_id', 'assignee_id', 'priority', 'start_date', 'due_date', 'parent_id', 'rank', 'created_by',
    'started_at', 'closed_at', 'archived_at',
])]
final class WorkItem extends Model
{
    /** @use HasFactory<WorkItemFactory> */
    use HasFactory, HasUlids, Searchable;

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
     * Set by GetWorkItem, never stored: what WorkItemResource embeds besides the item (`children`, `type`, `workflow`,
     * `relations`, `attachments`), loaded there already (`attachments` only the files of the file list).
     *
     * @var list<string>
     */
    public array $includes = [];

    /**
     * Set by GetWorkItem with `include=relations`, never stored: the relations of the item as its reader sees them
     * (ListRelations::of()), embedded by WorkItemResource.
     *
     * @var list<array{relation: WorkItemRelation, other: ?WorkItem, direction: 'outward'|'inward', hidden: bool}>
     */
    public array $relation_entries = [];

    /**
     * Set by loadForResource(), never stored: whether WorkItemResource leaves out the description and the Markdown of
     * the rich text values (`lean`, P17: lists ask lean, the detail in full).
     */
    public bool $lean = false;

    /**
     * Set by loadForResource() for an item that is not lean, never stored: what its reader may see of the mentions and
     * references of its description and rich text values (current handles, key and title of each referenced item the
     * reader sees), for the Markdown of WorkItemResource.
     */
    public ?RichTextNames $rich_names = null;

    /**
     * Loads everything WorkItemResource reads, for one item or a list, with a fixed number of queries (none per item):
     * `project`, `parent.project`, `labels`, `values.property`, the computed columns of withComputed() (one query, set
     * on the models as they are, never written back) and `subscribed` for the reader (K5). The resource then asks the
     * database nothing. `$lean` makes the resource leave out the descriptions (P17); without it the texts of the items
     * get `rich_names` for the reader, with one query for all mentioned accounts and one for all referenced items the
     * reader sees (none without such nodes).
     *
     * @param  EloquentCollection<int, self>|self  $items
     */
    public static function loadForResource(EloquentCollection|self $items, User $reader, bool $lean = false): void
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
            $item->lean = $lean;
        }

        if (! $lean) {
            $names = self::richNames($items, $reader);
            $items->each(fn (self $item) => $item->rich_names = $names);
        }
    }

    /**
     * The names the texts of the items need for one reader: the handles of the mentioned accounts, the key and title of
     * each referenced item the reader sees (Visibility); a reference to any other item is hidden.
     *
     * @param  EloquentCollection<int, self>  $items
     */
    private static function richNames(EloquentCollection $items, User $reader): RichTextNames
    {
        $people = $refs = [];
        foreach ($items as $item) {
            $texts = $item->values->filter(fn (WorkItemValue $row) => $row->property->field_type === FieldType::RichText)
                ->map(fn (WorkItemValue $row) => (array) $row->value_json)->values()->all();
            foreach ($item->description === null ? $texts : [$item->description, ...$texts] as $json) {
                $text = Document::fromJson($json);
                array_push($people, ...$text->mentionedUserIds());
                array_push($refs, ...$text->itemRefs());
            }
        }
        $handles = $names = $seen = [];
        foreach (array_chunk(array_values(array_unique($people)), RichTextLookups::CHUNK) as $chunk) {
            foreach (User::query()->whereKey($chunk)->get(['id', 'handle', 'name']) as $user) {
                $handles[$user->id] = $user->handle;
                $names[$user->id] = $user->name;
            }
        }
        $refs = array_values(array_unique($refs));
        $visible = $refs === [] ? [] : Visibility::projectIds($reader)->all();
        foreach (array_chunk($refs, RichTextLookups::CHUNK) as $chunk) {
            $rows = self::query()->join('projects', 'projects.id', '=', 'work_items.project_id')
                ->whereIn('work_items.id', $chunk)->whereIn('work_items.project_id', $visible)
                ->toBase()->get(['work_items.id', 'work_items.title', 'work_items.number', 'projects.identifier']);
            foreach ($rows as $row) {
                $seen[(string) $row->id] = ['key' => "{$row->identifier}-{$row->number}", 'title' => (string) $row->title];
            }
        }

        return new RichTextNames($handles, $seen, $names);
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
        // the outer table through the model, as `visibleTo` names it (one place to change for an aliased list query)
        $id = $query->qualifyColumn('id');
        $children = fn () => DB::query()->from('work_items as children')->selectRaw('count(*)')->whereColumn('children.parent_id', $id);

        $query->addSelect([
            'children_total' => $children(),
            'children_done' => $children()
                ->join('workflow_states as child_states', 'child_states.id', '=', 'children.state_id')
                ->whereIn('child_states.category', self::closedCategories()),
            'is_blocked' => self::blocks($query, false),
            'is_blocking' => self::blocks($query, true),
        ]);
    }

    /**
     * Whether the open item of the outer query blocks an open item (`$blocking`) or is blocked by one, through the
     * built-in relation type `blocks`: a scalar subquery (`count(*) > 0`), the select of withComputed() and the
     * condition of the filter (`App\Views\FilterQuery`) alike (K3).
     *
     * @param  Builder<self>  $outer
     */
    public static function blocks(Builder $outer, bool $blocking): QueryBuilder
    {
        [$self, $other] = $blocking ? ['source_id', 'target_id'] : ['target_id', 'source_id'];
        $open = fn (QueryBuilder $states) => $states->select('id')->from('workflow_states')->whereNotIn('category', self::closedCategories());

        return DB::query()->from('work_item_relations as blocks')
            ->selectRaw('count(*) > 0')
            ->join('relation_types as block_types', 'block_types.id', '=', 'blocks.type_id')
            ->join('work_items as other_end', 'other_end.id', '=', "blocks.{$other}")
            ->where('block_types.built_in', 'blocks')
            ->whereColumn("blocks.{$self}", $outer->qualifyColumn('id'))
            ->whereIn('other_end.state_id', $open)
            ->whereIn($outer->qualifyColumn('state_id'), $open);
    }

    /**
     * The search document (index `work_items`, settings in config/scout.php): the key, the title and the plain text of
     * the description to search, the rest to filter by. Who may see the item is not in it: the search filters by the
     * projects the reader sees when it asks (P2). Reads `project`, `labels` and `state` (loaded at once by
     * makeAllSearchableUsing()).
     *
     * @return array{id: string, project_id: string, key: string, number: int, title: string, description: string, type_id: string, state_category: string, assignee_id: string|null, label_ids: list<string>, archived: bool, updated_at: int}
     */
    public function toSearchableArray(): array
    {
        return [
            'id' => $this->id,
            'project_id' => $this->project_id,
            'key' => $this->key,
            'number' => $this->number,
            'title' => $this->title,
            'description' => $this->description_text ?? '',
            'type_id' => $this->type_id,
            'state_category' => $this->state->category->value,
            'assignee_id' => $this->assignee_id,
            'label_ids' => array_values($this->labels->map(fn (Label $label) => $label->id)->all()),
            'archived' => $this->archived_at !== null,
            'updated_at' => (int) $this->updated_at?->getTimestamp(),
        ];
    }

    /**
     * What toSearchableArray() reads, loaded with the query of a rebuild (makeAllSearchableQuery()). Items of a project
     * being deleted stay out: a reindex after removeProject() would bring their documents back for good (K11).
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    protected function makeAllSearchableUsing(Builder $query): Builder
    {
        return $query->with(['project:id,identifier', 'labels:labels.id', 'state:id,category'])
            ->whereIn('work_items.project_id', Project::query()->whereNull('deleting_at')->select('id'));
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
     * The attachments the item owns: the files of its file list (`file`) and the pictures and files of its texts
     * (`inline`), oldest first.
     *
     * @return MorphMany<Attachment, $this>
     */
    public function attachments(): MorphMany
    {
        return $this->morphMany(Attachment::class, 'attachable')->orderBy('created_at')->orderBy('id');
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
