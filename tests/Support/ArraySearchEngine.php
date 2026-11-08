<?php

namespace Tests\Support;

use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Search\CountsDocuments;
use App\Search\RemovesWhere;
use App\Search\ReportsStatus;
use App\Search\SwapsIndexes;
use Closure;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\LazyCollection;
use Laravel\Scout\Builder;
use Laravel\Scout\Contracts\UpdatesIndexSettings;
use Laravel\Scout\Engines\Engine;
use LogicException;
use Throwable;

/**
 * The search engine of the feature tests (P10): it keeps the documents per index in memory, as Meilisearch would get
 * them, and searches them roughly as the index settings of config/scout.php ask: a hit holds every word of the query
 * (lower case, also as part of a word) in one of the `searchableAttributes` of its index. `wheres` compare equal (a bool
 * as stored, `null` hits a field that is `null` like `IS NULL`), `whereIns` with in_array(…, true), on a list field
 * (`label_ids`) when any element is one of the values; hits come in the order the documents came in, `take()` cuts them.
 * `$builder->callback` and `$builder->options` speak to Meilisearch and are passed over. Its status (ReportsStatus) is
 * `ok` without tasks, `down` after failWith(). It swaps indexes (SwapsIndexes) as Meilisearch does, documents and
 * settings together, so a rebuild in the feature tests goes through the index beside the live one. Real Meilisearch runs in tests/Integration (Tests\Support\Meili).
 */
final class ArraySearchEngine extends Engine implements CountsDocuments, RemovesWhere, ReportsStatus, SwapsIndexes, UpdatesIndexSettings
{
    /** @var array<string, array<string, array<string, mixed>>> the documents of each index by key, in the order they came in */
    private array $indexes = [];

    /** @var array<string, array<string, mixed>> */
    private array $settings = [];

    private ?Throwable $error = null;

    private int $writes = 0;

    /** @var list<string> */
    private array $searched = [];

    /** @var list<array<string, mixed>> */
    private array $options = [];

    /**
     * The documents of an index (with its prefix: `testing_work_items`) by key.
     *
     * @return array<string, array<string, mixed>>
     */
    public function documents(string $index): array
    {
        return $this->indexes[$index] ?? [];
    }

    /**
     * The settings last sent for an index, `null` when none came.
     *
     * @return array<string, mixed>|null
     */
    public function updatedSettings(string $index): ?array
    {
        return $this->settings[$index] ?? null;
    }

    /**
     * The indexes that exist (hold documents or settings), by name.
     *
     * @return list<string>
     */
    public function indexNames(): array
    {
        $names = array_keys([...$this->indexes, ...$this->settings]);
        sort($names);

        return $names;
    }

    /** How often the index was written (`update`, `delete`, `flush`, `removeWhere`); a write that threw does not count. */
    public function writes(): int
    {
        return $this->writes;
    }

    /**
     * The indexes searched so far, in order (one entry per search).
     *
     * @return list<string>
     */
    public function searched(): array
    {
        return $this->searched;
    }

    /**
     * The options of each search so far (what Meilisearch would be asked with), in order.
     *
     * @return list<array<string, mixed>>
     */
    public function options(): array
    {
        return $this->options;
    }

    /**
     * Changes every document of an index in place, as an index written by an older version would hold it (a field
     * missing, a field more). Counts as no write.
     *
     * @param  Closure(array<string, mixed>, string): array<string, mixed>  $change  gets the document and its key
     */
    public function rewrite(string $index, Closure $change): void
    {
        foreach ($this->documents($index) as $key => $document) {
            $this->indexes[$index][$key] = $change($document, (string) $key);
        }
    }

    /** Lets every search and every write throw this error from now on (`null` lets them work again). */
    public function failWith(?Throwable $error): void
    {
        $this->error = $error;
    }

    public function documentStats(string $index): array
    {
        $fields = [];
        foreach ($this->documents($index) as $document) {
            foreach (array_keys($document) as $field) {
                $fields[$field] = ($fields[$field] ?? 0) + 1;
            }
        }

        return ['documents' => count($this->documents($index)), 'fields' => $fields];
    }

    public function status(): array
    {
        return $this->error === null
            ? ['search' => 'ok', 'search_tasks' => ['enqueued' => 0, 'processing' => 0, 'failed_last_day' => 0]]
            : ['search' => 'down', 'search_tasks' => null];
    }

    /**
     * @param  EloquentCollection<int, Model>  $models
     */
    public function update($models): void
    {
        if ($models->isEmpty()) {
            return;
        }

        $this->write();

        foreach ($models as $model) {
            $document = $model->toSearchableArray();
            if ($document === []) {
                continue;
            }

            $this->indexes[$model->indexableAs()][(string) $model->getScoutKey()] = [
                ...$document,
                ...$model->scoutMetadata(),
                $model->getScoutKeyName() => $model->getScoutKey(),
            ];
        }
    }

    /**
     * @param  EloquentCollection<int, Model>  $models
     */
    public function delete($models): void
    {
        if ($models->isEmpty()) {
            return;
        }

        $this->write();

        foreach ($models as $model) {
            unset($this->indexes[$model->indexableAs()][(string) $model->getScoutKey()]);
        }
    }

    /**
     * @param  EloquentCollection<int, covariant WorkItem|Page|Project|User>  $models
     */
    public function updateIn(string $index, EloquentCollection $models): void
    {
        $this->write();

        foreach ($models as $model) {
            $this->indexes[$index][(string) $model->getScoutKey()] = [
                ...$model->toSearchableArray(),
                ...$model->scoutMetadata(),
                $model->getScoutKeyName() => $model->getScoutKey(),
            ];
        }
    }

    public function swap(string $a, string $b): void
    {
        $this->write();

        [$this->indexes[$a], $this->indexes[$b]] = [$this->indexes[$b] ?? [], $this->indexes[$a] ?? []];
        [$this->settings[$a], $this->settings[$b]] = [$this->settings[$b] ?? [], $this->settings[$a] ?? []];
    }

    public function dropIndex(string $index, bool $ifExists = false): void
    {
        $this->write();

        unset($this->indexes[$index], $this->settings[$index]);
    }

    public function removeWhere(Model $model, string $field, string $value): void
    {
        $this->write();

        $index = $model->indexableAs();
        $this->indexes[$index] = array_filter(
            $this->documents($index),
            fn (array $document) => is_array($document[$field] ?? null)
                ? ! in_array($value, $document[$field], true)
                : ($document[$field] ?? null) !== $value,
        );
    }

    public function flush($model): void
    {
        $this->write();

        unset($this->indexes[$model->indexableAs()]);
    }

    /**
     * @return array{ids: list<string>, total: int}
     */
    public function search(Builder $builder): array
    {
        $ids = $this->matches($builder);

        return ['ids' => $builder->limit === null ? $ids : array_slice($ids, 0, $builder->limit), 'total' => count($ids)];
    }

    /**
     * @return array{ids: list<string>, total: int}
     */
    public function paginate(Builder $builder, $perPage, $page): array
    {
        $ids = $this->matches($builder);

        return ['ids' => array_slice($ids, ($page - 1) * $perPage, $perPage), 'total' => count($ids)];
    }

    /**
     * @param  array{ids: list<string>, total: int}  $results
     * @return Collection<int, string>
     */
    public function mapIds($results): Collection
    {
        return collect($results['ids']);
    }

    /**
     * @param  array{ids: list<string>, total: int}  $results
     */
    public function map(Builder $builder, $results, $model): mixed
    {
        $ids = $results['ids'];
        if ($ids === []) {
            return $model->newCollection();
        }

        $positions = array_flip($ids);

        return $model->getScoutModelsByIds($builder, $ids)
            ->filter(fn (Model $found) => isset($positions[$found->getScoutKey()]))
            ->sortBy(fn (Model $found) => $positions[$found->getScoutKey()])
            ->values();
    }

    /**
     * @param  array{ids: list<string>, total: int}  $results
     */
    public function lazyMap(Builder $builder, $results, $model): LazyCollection
    {
        $ids = $results['ids'];
        if ($ids === []) {
            return LazyCollection::empty();
        }

        $positions = array_flip($ids);

        return $model->queryScoutModelsByIds($builder, $ids)->cursor()
            ->filter(fn (Model $found) => isset($positions[$found->getScoutKey()]))
            ->sortBy(fn (Model $found) => $positions[$found->getScoutKey()])
            ->values();
    }

    /**
     * @param  array{ids: list<string>, total: int}  $results
     */
    public function getTotalCount($results): int
    {
        return $results['total'];
    }

    public function createIndex($name, array $options = []): mixed
    {
        return null;
    }

    public function deleteIndex($name): mixed
    {
        return null;
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    public function updateIndexSettings(string $name, array $settings = []): void
    {
        $this->fail();

        $this->settings[$name] = $settings;
    }

    /**
     * @param  array<string, mixed>  $settings
     * @return array<string, mixed>
     */
    public function configureSoftDeleteFilter(array $settings = []): array
    {
        $settings['filterableAttributes'][] = '__soft_deleted';

        return $settings;
    }

    /**
     * The keys of the documents that match the builder, in the order they came in.
     *
     * @return list<string>
     */
    private function matches(Builder $builder): array
    {
        $this->fail();

        $index = $builder->index ?: $builder->model->searchableAs();
        $this->searched[] = $index;
        $this->options[] = $builder->options;
        $attributes = config('scout.meilisearch.index-settings')[$builder->model::class]['searchableAttributes'] ?? [];
        $words = preg_split('/\s+/u', mb_strtolower(trim((string) $builder->query)), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $ids = [];

        foreach ($this->documents($index) as $key => $document) {
            if ($this->filtered($builder, $document) && $this->holdsEvery($words, $attributes, $document)) {
                $ids[] = (string) $key;
            }
        }

        return $ids;
    }

    /**
     * @param  array<string, mixed>  $document
     */
    private function filtered(Builder $builder, array $document): bool
    {
        foreach ($builder->wheres as $where) {
            if ($where['operator'] !== '=') {
                throw new LogicException("ArraySearchEngine compares with = only, not with {$where['operator']}.");
            }
            if (($document[$where['field']] ?? null) !== $where['value']) {
                return false;
            }
        }

        foreach ($builder->whereIns as $field => $values) {
            // a list (`label_ids`) matches as Meilisearch matches it: when any of its elements is one of the values
            $held = $document[$field] ?? null;
            $matches = is_array($held)
                ? array_any($held, fn (mixed $element) => in_array($element, $values, true))
                : in_array($held, $values, true);
            if (! $matches) {
                return false;
            }
        }

        foreach ($builder->whereNotIns as $field => $values) {
            if (in_array($document[$field] ?? null, $values, true)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  list<string>  $words
     * @param  list<string>  $attributes
     * @param  array<string, mixed>  $document
     */
    private function holdsEvery(array $words, array $attributes, array $document): bool
    {
        $texts = array_map(
            fn (string $attribute) => mb_strtolower(implode(' ', array_map(strval(...), (array) ($document[$attribute] ?? [])))),
            $attributes,
        );

        foreach ($words as $word) {
            if (! array_any($texts, fn (string $text) => str_contains($text, $word))) {
                return false;
            }
        }

        return true;
    }

    private function write(): void
    {
        $this->fail();

        $this->writes++;
    }

    private function fail(): void
    {
        if ($this->error !== null) {
            throw $this->error;
        }
    }
}
