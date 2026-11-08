<?php

namespace App\Search;

use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Laravel\Scout\Contracts\UpdatesIndexSettings;
use Laravel\Scout\EngineManager;

/**
 * Writes the search index: one document at a time (the search consumer), the items of some projects (ReindexWorkItems)
 * or everything from scratch (app:search-import, the seeders). It reads the rows fresh, with what the documents need
 * (makeAllSearchableQuery()), and writes only through Scout: the synchronous paths of searchable() and unsearchable()
 * (it runs on the queue `search` already), flush, the index settings and removeWhere (K5). Who may see a document is
 * never stored here: the search filters when it asks (P2).
 */
final class SearchIndexer
{
    /** The searchable models, by the name of their table (the index without its prefix). */
    private const MODELS = ['work_items' => WorkItem::class, 'pages' => Page::class, 'projects' => Project::class, 'users' => User::class];

    private const CHUNK = 500;

    /** The most bytes of comment text in an item's document (A245), and of text in a page's document (A317). */
    public const COMMENTS_MAX = 65536;

    public function __construct(private readonly EngineManager $engines) {}

    /**
     * The text of an item's comments for its document (A245): one after the other, separated by a line break, cut at
     * COMMENTS_MAX bytes without splitting a character. Joins no more texts than the limit takes.
     *
     * @param  list<string>  $texts  the plain text of each comment, oldest first
     */
    public static function commentsText(array $texts): string
    {
        $parts = [];
        $length = -1;
        foreach ($texts as $text) {
            $parts[] = $text;
            $length += strlen($text) + 1;
            if ($length >= self::COMMENTS_MAX) {
                break;
            }
        }

        return self::cut(implode("\n", $parts));
    }

    /** The text cut at COMMENTS_MAX bytes without splitting a character. */
    public static function cut(string $text): string
    {
        return mb_strcut($text, 0, self::COMMENTS_MAX, 'UTF-8');
    }

    /** Writes the document of an item, or removes it when the item is gone or its project is being deleted (K11). */
    public function upsertItem(string $id): void
    {
        $item = $this->query(WorkItem::class)->whereKey($id)->first();

        if ($item === null) {
            $this->removeItem($id);

            return;
        }

        $item->searchableSync();
    }

    public function removeItem(string $id): void
    {
        (new WorkItem)->setRawAttributes(['id' => $id])->unsearchableSync();
    }

    /** Writes the document of a project; a project that is gone or being deleted loses only its own document. */
    public function upsertProject(string $id): void
    {
        $project = $this->query(Project::class)->whereKey($id)->first();

        if ($project === null || ! $project->shouldBeSearchable()) {
            (new Project)->setRawAttributes(['id' => $id])->unsearchableSync();

            return;
        }

        $project->searchableSync();
    }

    /** Writes the document of a page, or removes it when the page is gone or its project is being deleted. */
    public function upsertPage(string $id): void
    {
        $page = $this->query(Page::class)->whereKey($id)->first();

        if ($page === null || ! $page->shouldBeSearchable()) {
            $this->removePages([$id]);

            return;
        }

        $page->searchableSync();
    }

    /**
     * Removes the documents of these pages (a deleted subtree: `meta.page_ids` of `page.deleted`), in one write.
     *
     * @param  list<string>  $ids
     */
    public function removePages(array $ids): void
    {
        if ($ids === []) {
            return;
        }

        (new Page)->syncRemoveFromSearch((new Page)->newCollection(array_map(fn (string $id) => (new Page)->setRawAttributes(['id' => $id]), $ids)));
    }

    /** Removes the document of a project and of all its items and pages, also when their rows are gone already. */
    public function removeProject(string $id): void
    {
        (new Project)->setRawAttributes(['id' => $id])->unsearchableSync();

        $engine = $this->engines->engine();
        if ($engine instanceof RemovesWhere) {
            $engine->removeWhere(new WorkItem, 'project_id', $id);
            $engine->removeWhere(new Page, 'project_id', $id);
        }
    }

    public function upsertUser(string $id): void
    {
        (new User)->syncMakeSearchable($this->query(User::class)->whereKey($id)->get());
    }

    /**
     * Writes the documents of the items of these projects again (`null`: of every project), as a catalog change or a
     * new identifier changes what they hold; with `$itemIds` only of those items (a deleted label names the items that
     * carried it), read a block of ids at a time, so no statement binds more ids than a block holds.
     *
     * @param  list<string>|null  $projectIds
     * @param  list<string>|null  $itemIds
     */
    public function reindexItems(?array $projectIds, ?array $itemIds = null): void
    {
        $query = fn () => $this->query(WorkItem::class)
            ->when($projectIds !== null, fn (Builder $query) => $query->whereIn('work_items.project_id', $projectIds));

        if ($itemIds === null) {
            $query()->chunkById(self::CHUNK, fn (Collection $chunk) => (new WorkItem)->syncMakeSearchable($chunk), 'work_items.id', 'id');

            return;
        }

        foreach (array_chunk($itemIds, self::CHUNK) as $block) {
            (new WorkItem)->syncMakeSearchable($query()->whereIn('work_items.id', $block)->get());
        }
    }

    /** Sends the settings of config/scout.php to every index, when the engine takes settings (Meilisearch does). */
    public function syncSettings(): void
    {
        $engine = $this->engines->engine();
        if (! $engine instanceof UpdatesIndexSettings) {
            return;
        }

        /** @var array<class-string<WorkItem|Page|Project|User>, array<string, mixed>> $settings */
        $settings = config('scout.meilisearch.index-settings');

        foreach ($settings as $class => $indexSettings) {
            $engine->updateIndexSettings((new $class)->indexableAs(), $indexSettings);
        }
    }

    /**
     * Whether a start has to import: an index whose table has searchable rows but whose documents are missing (a new
     * Meilisearch volume, a new index) or hold other fields than the model writes today (an update gave
     * toSearchableArray() a field, or took one). Every field has to occur in every document: a document the consumer
     * wrote after the update has the new field, the older ones lack it. Rows of a project being deleted count as none
     * (they have no document). An engine that cannot describe its documents never asks for an import.
     */
    public function needsImport(): bool
    {
        $engine = $this->engines->engine();
        if (! $engine instanceof CountsDocuments) {
            return false;
        }

        foreach (self::MODELS as $class) {
            $model = $this->firstSearchable($class);
            if ($model === null) {
                continue;
            }

            ['documents' => $documents, 'fields' => $fields] = $engine->documentStats($model->indexableAs());
            $written = array_fill_keys(array_keys([
                ...$model->toSearchableArray(), ...$model->scoutMetadata(), $model->getScoutKeyName() => null,
            ]), $documents);
            ksort($written);
            ksort($fields);

            if ($documents === 0 || $fields !== $written) {
                return true;
            }
        }

        return false;
    }

    /**
     * The first row of the model that gets a document: never one of a project being deleted (items leave those out in
     * their query already).
     *
     * @param  class-string<WorkItem|Page|Project|User>  $class
     */
    private function firstSearchable(string $class): WorkItem|Page|Project|User|null
    {
        $query = $this->query($class);

        if ($class === Project::class) {
            $query->whereNull('projects.deleting_at');
        }
        if ($class === Page::class) {
            $query->whereIn('pages.project_id', Project::query()->whereNull('deleting_at')->select('id'));
        }

        return $query->first();
    }

    /**
     * Builds every index from scratch (P18): the settings, then each index emptied and filled from the database.
     *
     * @return array{work_items: int, pages: int, projects: int, users: int} the documents written to each index
     */
    public function rebuild(): array
    {
        $this->syncSettings();

        $counts = [];
        foreach (self::MODELS as $table => $class) {
            $this->engines->engine()->flush(new $class);
            $counts[$table] = $this->import($class);
        }

        return $counts;
    }

    /**
     * Writes every searchable row of the model, as Scout's makeAllSearchable() does, and counts the documents.
     *
     * @param  class-string<WorkItem|Page|Project|User>  $class
     */
    private function import(string $class): int
    {
        $count = 0;
        $model = new $class;

        $this->query($class)->chunkById(self::CHUNK, function (Collection $chunk) use ($model, &$count): void {
            $searchable = $chunk->filter(fn (WorkItem|Page|Project|User $found) => $found->shouldBeSearchable());
            $model->syncMakeSearchable($searchable);
            $count += $searchable->count();
        }, $model->qualifyColumn('id'), 'id');

        return $count;
    }

    /**
     * The query of a rebuild (Scout's makeAllSearchableQuery(): the model's makeAllSearchableUsing(), ordered by key).
     *
     * @template T of WorkItem|Page|Project|User
     *
     * @param  class-string<T>  $class
     * @return Builder<T>
     */
    private function query(string $class): Builder
    {
        /** @var Builder<T> $query */
        $query = $class::makeAllSearchableQuery();

        return $query;
    }
}
