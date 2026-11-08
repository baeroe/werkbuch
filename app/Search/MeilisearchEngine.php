<?php

namespace App\Search;

use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use Laravel\Scout\Engines\MeilisearchEngine as ScoutMeilisearchEngine;
use Meilisearch\Client;
use Meilisearch\Contracts\TasksQuery;
use Meilisearch\Exceptions\ApiException;

/**
 * Scout's Meilisearch engine, which can also remove documents by a filter (RemovesWhere), say how Meilisearch is
 * (ReportsStatus) and fill an index beside the live one to swap them (SwapsIndexes; only indexes with `scout.prefix`). AppServiceProvider sets it as the driver `meilisearch`. The status (PoolsStatus) asks with plain
 * HTTP requests of 2 s, which the system page sends in one pool together with the Reverb probe (K21), so a Meilisearch
 * that hangs never holds it for long; it counts only the tasks of the indexes of this instance (the models of `scout.meilisearch.index-settings` with `scout.prefix`).
 */
final class MeilisearchEngine extends ScoutMeilisearchEngine implements CountsDocuments, PoolsStatus, RemovesWhere, SwapsIndexes
{
    /** The keys of the status requests in the pool, so they do not meet those of another caller. */
    public const STATUS_PREFIX = 'search.';

    public function __construct(Client $meilisearch, bool $softDelete, private readonly string $host, private readonly ?string $key)
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
        $responses = Http::pool(fn (Pool $pool) => $this->statusRequests($pool));

        return $this->statusFrom($responses);
    }

    public function statusRequests(Pool $pool): void
    {
        $this->statusRequest($pool, 'health')->get($this->host.'/health');
        foreach (['enqueued' => false, 'processing' => false, 'failed' => true] as $status => $afterFinished) {
            $query = (new TasksQuery)->setStatuses([$status])->setIndexUids($this->indexes())->setLimit(1);
            if ($afterFinished) {
                $query->setAfterFinishedAt(now()->subDay()->toDateTimeImmutable());
            }
            $this->statusRequest($pool, $status)->get($this->host.'/tasks', $query->toArray());
        }
    }

    public function statusFrom(array $responses): array
    {
        $counts = [];
        foreach (['health', 'enqueued', 'processing', 'failed'] as $name) {
            $response = $responses[self::STATUS_PREFIX.$name] ?? null;
            if (! $response instanceof Response || ! $response->successful()) {
                return ['search' => 'down', 'search_tasks' => null];
            }
            $counts[$name] = (int) $response->json('total');
        }

        return ['search' => 'ok', 'search_tasks' => [
            'enqueued' => $counts['enqueued'],
            'processing' => $counts['processing'],
            'failed_last_day' => $counts['failed'],
        ]];
    }

    private function statusRequest(Pool $pool, string $name): PendingRequest
    {
        return $pool->as(self::STATUS_PREFIX.$name)->connectTimeout(2)->timeout(2)->acceptJson()
            ->when($this->key !== null && $this->key !== '', fn (PendingRequest $request) => $request->withToken((string) $this->key));
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
