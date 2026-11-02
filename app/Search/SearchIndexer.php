<?php

namespace App\Search;

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
    private const MODELS = ['work_items' => WorkItem::class, 'projects' => Project::class, 'users' => User::class];

    private const CHUNK = 500;

    public function __construct(private readonly EngineManager $engines) {}

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

    /** Removes the document of a project and of all its items, also when their rows are gone already. */
    public function removeProject(string $id): void
    {
        (new Project)->setRawAttributes(['id' => $id])->unsearchableSync();

        $engine = $this->engines->engine();
        if ($engine instanceof RemovesWhere) {
            $engine->removeWhere(new WorkItem, 'project_id', $id);
        }
    }

    public function upsertUser(string $id): void
    {
        (new User)->syncMakeSearchable($this->query(User::class)->whereKey($id)->get());
    }

    /**
     * Writes the documents of the items of these projects again (`null`: of every project), as a catalog change or a
     * new identifier changes what they hold.
     *
     * @param  list<string>|null  $projectIds
     */
    public function reindexItems(?array $projectIds): void
    {
        $this->query(WorkItem::class)
            ->when($projectIds !== null, fn (Builder $query) => $query->whereIn('work_items.project_id', $projectIds))
            ->chunkById(self::CHUNK, fn (Collection $chunk) => (new WorkItem)->syncMakeSearchable($chunk), 'work_items.id', 'id');
    }

    /** Sends the settings of config/scout.php to every index, when the engine takes settings (Meilisearch does). */
    public function syncSettings(): void
    {
        $engine = $this->engines->engine();
        if (! $engine instanceof UpdatesIndexSettings) {
            return;
        }

        /** @var array<class-string<WorkItem|Project|User>, array<string, mixed>> $settings */
        $settings = config('scout.meilisearch.index-settings');

        foreach ($settings as $class => $indexSettings) {
            $engine->updateIndexSettings((new $class)->indexableAs(), $indexSettings);
        }
    }

    /**
     * Builds every index from scratch (P18): the settings, then each index emptied and filled from the database.
     *
     * @return array{work_items: int, projects: int, users: int} the documents written to each index
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
     * @param  class-string<WorkItem|Project|User>  $class
     */
    private function import(string $class): int
    {
        $count = 0;
        $model = new $class;

        $this->query($class)->chunkById(self::CHUNK, function (Collection $chunk) use ($model, &$count): void {
            $searchable = $chunk->filter(fn (WorkItem|Project|User $found) => $found->shouldBeSearchable());
            $model->syncMakeSearchable($searchable);
            $count += $searchable->count();
        }, $model->qualifyColumn('id'), 'id');

        return $count;
    }

    /**
     * The query of a rebuild (Scout's makeAllSearchableQuery(): the model's makeAllSearchableUsing(), ordered by key).
     *
     * @template T of WorkItem|Project|User
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
