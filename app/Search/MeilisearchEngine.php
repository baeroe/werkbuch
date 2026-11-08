<?php

namespace App\Search;

use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;
use Laravel\Scout\Engines\MeilisearchEngine as ScoutMeilisearchEngine;
use Meilisearch\Client;
use Meilisearch\Contracts\TasksQuery;
use Meilisearch\Exceptions\ApiException;
use Meilisearch\Exceptions\ExceptionInterface;
use Psr\Http\Client\ClientExceptionInterface;

/**
 * Scout's Meilisearch engine, which can also remove documents by a filter (RemovesWhere), say how Meilisearch is
 * (ReportsStatus) and fill an index beside the live one to swap them (SwapsIndexes; only indexes with `scout.prefix`). AppServiceProvider sets it as the driver `meilisearch`. The status asks over its own client with
 * short timeouts (`$statusClient`, 2 s), so a Meilisearch that hangs never holds the system page; it counts only the
 * tasks of the indexes of this instance (the models of `scout.meilisearch.index-settings` with `scout.prefix`).
 */
final class MeilisearchEngine extends ScoutMeilisearchEngine implements CountsDocuments, RemovesWhere, ReportsStatus, SwapsIndexes
{
    public function __construct(Client $meilisearch, bool $softDelete, private readonly Client $statusClient)
    {
        parent::__construct($meilisearch, $softDelete);
    }

    public function removeWhere(Model $model, string $field, string $value): void
    {
        $index = method_exists($model, 'indexableAs')
            ? $model->indexableAs()
            : throw new InvalidArgumentException($model::class.' is not searchable.');

        $this->meilisearch->index($index)
            ->deleteDocuments(['filter' => sprintf('%s = "%s"', $field, addcslashes($value, '"\\'))]);
    }

    /**
     * Writes the documents as Scout's update() does, into another index (soft deletes, embeddings and models without a
     * document, which werkbuch does not have, left out).
     *
     * @param  Collection<int, covariant WorkItem|Page|Project|User>  $models
     */
    public function updateIn(string $index, Collection $models): void
    {
        $this->ownIndex($index);

        if ($models->isEmpty()) {
            return;
        }

        $this->meilisearch->index($index)->addDocuments($models->map(fn (WorkItem|Page|Project|User $model) => [
            ...$model->toSearchableArray(), ...$model->scoutMetadata(), $model->getScoutKeyName() => $model->getScoutKey(),
        ])->values()->all(), $models->first()->getScoutKeyName());
    }

    /**
     * Meilisearch swaps only indexes that exist: `$a` (the live index) is created first when it is missing (a new
     * installation). Its tasks run in the order they came in, so the swap waits for the documents written before.
     */
    public function swap(string $a, string $b): void
    {
        $this->ownIndex($a);
        $this->ownIndex($b);

        $this->createIndex($a);
        $this->meilisearch->swapIndexes([[$a, $b]]);
    }

    public function dropIndex(string $index, bool $ifExists = false): void
    {
        $this->ownIndex($index);

        if ($ifExists) {
            try {
                $this->meilisearch->getIndex($index);
            } catch (ApiException $e) {
                if ($e->errorCode === 'index_not_found') {
                    return;
                }

                throw $e;
            }
        }

        $this->meilisearch->deleteIndex($index);
    }

    public function documentStats(string $index): array
    {
        try {
            $stats = $this->meilisearch->index($index)->stats();
        } catch (ApiException $e) {
            if ($e->errorCode === 'index_not_found') {
                return ['documents' => 0, 'fields' => []];
            }

            throw $e;
        }

        /** @var array<string, int> $fields */
        $fields = array_map(intval(...), (array) ($stats['fieldDistribution'] ?? []));

        return ['documents' => (int) $stats['numberOfDocuments'], 'fields' => $fields];
    }

    public function status(): array
    {
        try {
            $this->statusClient->health();

            return ['search' => 'ok', 'search_tasks' => [
                'enqueued' => $this->countTasks(['enqueued']),
                'processing' => $this->countTasks(['processing']),
                'failed_last_day' => $this->countTasks(['failed'], afterFinished: true),
            ]];
        } catch (ExceptionInterface|ClientExceptionInterface) {
            return ['search' => 'down', 'search_tasks' => null];
        }
    }

    /**
     * @param  list<string>  $statuses
     */
    private function countTasks(array $statuses, bool $afterFinished = false): int
    {
        $query = (new TasksQuery)->setStatuses($statuses)->setIndexUids($this->indexes())->setLimit(1);
        if ($afterFinished) {
            $query->setAfterFinishedAt(now()->subDay()->toDateTimeImmutable());
        }

        return $this->statusClient->getTasks($query)->getTotal();
    }

    /**
     * The indexes of this instance, as Scout names them (`searchableAs()`: the prefix and the table).
     *
     * @return list<string>
     */
    private function indexes(): array
    {
        /** @var array<class-string<WorkItem|Project|User>, mixed> $settings */
        $settings = config('scout.meilisearch.index-settings');

        return array_map(fn (string $class): string => (new $class)->searchableAs(), array_keys($settings));
    }

    /** Only an index of this installation (with `scout.prefix`) may be written beside, swapped or dropped (K14). */
    private function ownIndex(string $index): void
    {
        $prefix = (string) config('scout.prefix');
        if (! str_starts_with($index, $prefix)) {
            throw new InvalidArgumentException("The index {$index} does not start with {$prefix}.");
        }
    }
}
