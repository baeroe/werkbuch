<?php

namespace App\Models;

use App\Access\Visibility;
use App\RichText\RichTextNames;
use App\Search\SearchIndexer;
use App\Support\ReaderNames;
use Database\Factories\PageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Support\Carbon;
use Laravel\Scout\Searchable;

/**
 * A page of the wiki of a project (spec 4.15): a node of the tree (`parent_id`, `rank` among its siblings, compared byte
 * by byte), a title, an emoji and rich text (`content`, Tiptap JSON, and its plain text `content_text`). `version`
 * counts the saved states; the states kept before an overwrite are its versions (VersionRule). Who sees the project
 * sees its pages (`visibleTo`).
 *
 * @property string $id
 * @property string $project_id
 * @property string|null $parent_id
 * @property string $rank
 * @property string $title
 * @property string|null $emoji
 * @property array<string, mixed>|null $content
 * @property string|null $content_text
 * @property int $version
 * @property string $created_by
 * @property string $updated_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Project $project
 * @property-read Page|null $parent
 * @property-read EloquentCollection<int, Page> $children
 * @property-read User $creator
 * @property-read User $editor
 * @property-read EloquentCollection<int, PageVersion> $versions
 * @property-read EloquentCollection<int, Attachment> $attachments
 */
#[Fillable(['project_id', 'parent_id', 'rank', 'title', 'emoji', 'content', 'content_text', 'version', 'created_by', 'updated_by'])]
final class Page extends Model
{
    /** @use HasFactory<PageFactory> */
    use HasFactory, HasUlids, Searchable;

    /**
     * Set by loadForResource(), never stored: whether PageResource leaves out the content (`lean`: the tree, search
     * results and references ask lean, a page in full).
     */
    public bool $lean = false;

    /**
     * Set by loadForResource() for a page that is not lean, never stored: what its reader may see of the mentions and
     * references of its content, for the Markdown of PageResource.
     */
    public ?RichTextNames $rich_names = null;

    /**
     * Prepares one page or several for PageResource with a fixed number of queries (none per page, K5): lean pages ask
     * nothing; the others get the names of their texts for the reader (ReaderNames: one query for all mentioned
     * accounts, one for all referenced items and one for all referenced pages the reader sees, none without such nodes).
     *
     * @param  EloquentCollection<int, self>|self  $pages
     */
    public static function loadForResource(EloquentCollection|self $pages, User $reader, bool $lean = false): void
    {
        $pages = $pages instanceof self ? $pages->newCollection([$pages]) : $pages;
        $pages->each(fn (self $page) => $page->lean = $lean);

        if (! $lean) {
            $names = ReaderNames::of($pages->map(fn (self $page) => $page->content)->filter()->all(), $reader);
            $pages->each(fn (self $page) => $page->rich_names = $names);
        }
    }

    /**
     * Only the pages of the projects the account sees (App\Access\Visibility, the one access scope).
     *
     * @param  Builder<self>  $query
     */
    public function scopeVisibleTo(Builder $query, User $user): void
    {
        $query->whereIn('pages.project_id', Visibility::projectIds($user));
    }

    /**
     * The search document (index `pages`, settings in config/scout.php): the title and the plain text to search, cut at
     * SearchIndexer::COMMENTS_MAX bytes without splitting a character, the project to filter by. Who may see the page is
     * not in it: the search filters by the projects the reader sees when it asks (P2, A317).
     *
     * @return array{id: string, project_id: string, title: string, text: string, updated_at: int}
     */
    public function toSearchableArray(): array
    {
        return [
            'id' => $this->id,
            'project_id' => $this->project_id,
            'title' => $this->title,
            'text' => SearchIndexer::cut($this->content_text ?? ''),
            'updated_at' => (int) $this->updated_at?->getTimestamp(),
        ];
    }

    /** A page of a project being deleted is gone for everyone at once, from the index as well. */
    public function shouldBeSearchable(): bool
    {
        return $this->project->deleting_at === null;
    }

    /**
     * What toSearchableArray() and shouldBeSearchable() read, loaded with the query of a rebuild
     * (makeAllSearchableQuery()): only the columns of the document, the text cut by the database (no page brings its
     * Tiptap JSON or more text than the document takes, T12-M1), and whether its project is being deleted.
     *
     * @param  Builder<self>  $query
     * @return Builder<self>
     */
    protected function makeAllSearchableUsing(Builder $query): Builder
    {
        return $query->select(['pages.id', 'pages.project_id', 'pages.title', 'pages.updated_at'])
            ->selectRaw('left(pages.content_text, ?) as content_text', [SearchIndexer::COMMENTS_MAX])
            ->with('project:id,deleting_at');
    }

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * @return BelongsTo<self, $this>
     */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    /**
     * The pages right below, in their order (`rank` byte by byte, then the ULID).
     *
     * @return HasMany<self, $this>
     */
    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('rank')->orderBy('id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * Whoever saved the current state last.
     *
     * @return BelongsTo<User, $this>
     */
    public function editor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    /**
     * The kept states, the newest first.
     *
     * @return HasMany<PageVersion, $this>
     */
    public function versions(): HasMany
    {
        return $this->hasMany(PageVersion::class)->orderByDesc('version');
    }

    /**
     * The pictures and files of the text.
     *
     * @return MorphMany<Attachment, $this>
     */
    public function attachments(): MorphMany
    {
        return $this->morphMany(Attachment::class, 'attachable');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['content' => 'array', 'version' => 'int'];
    }
}
