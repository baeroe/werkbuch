<?php

namespace Tests\Support;

use App\Search\RemovesWhere;
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
 * as stored), `whereIns` with in_array(…, true); hits come in the order the documents came in, `take()` cuts them.
 * `$builder->callback` and `$builder->options` speak to Meilisearch and are passed over. Real Meilisearch runs in
 * tests/Integration (Tests\Support\Meili).
 */
final class ArraySearchEngine extends Engine implements RemovesWhere, UpdatesIndexSettings
{
    /** @var array<string, array<string, array<string, mixed>>> the documents of each index by key, in the order they came in */
    private array $indexes = [];

    /** @var array<string, array<string, mixed>> */
    private array $settings = [];

    private ?Throwable $error = null;

    private int $writes = 0;

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

    /** How often the index was written (`update`, `delete`, `flush`, `removeWhere`); a write that threw does not count. */
    public function writes(): int
    {
        return $this->writes;
    }

    /** Lets every search and every write throw this error from now on (`null` lets them work again). */
    public function failWith(?Throwable $error): void
    {
        $this->error = $error;
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

        $attributes = config('scout.meilisearch.index-settings')[$builder->model::class]['searchableAttributes'] ?? [];
        $words = preg_split('/\s+/u', mb_strtolower(trim((string) $builder->query)), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $ids = [];

        foreach ($this->documents($builder->index ?: $builder->model->searchableAs()) as $key => $document) {
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
            if (! in_array($document[$field] ?? null, $values, true)) {
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
