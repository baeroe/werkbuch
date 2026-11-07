<?php

namespace App\Search;

use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;
use Laravel\Scout\Engines\MeilisearchEngine as ScoutMeilisearchEngine;
use Meilisearch\Client;
use Meilisearch\Contracts\TasksQuery;
use Meilisearch\Exceptions\ApiException;
use Meilisearch\Exceptions\ExceptionInterface;
use Psr\Http\Client\ClientExceptionInterface;

/**
 * Scout's Meilisearch engine, which can also remove documents by a filter (RemovesWhere) and say how Meilisearch is
 * (ReportsStatus). AppServiceProvider sets it as the driver `meilisearch`. The status asks over its own client with
 * short timeouts (`$statusClient`, 2 s), so a Meilisearch that hangs never holds the system page; it counts only the
 * tasks of the indexes of this instance (the models of `scout.meilisearch.index-settings` with `scout.prefix`).
 */
final class MeilisearchEngine extends ScoutMeilisearchEngine implements CountsDocuments, RemovesWhere, ReportsStatus
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

    public function documentCount(string $index): int
    {
        try {
            return (int) $this->meilisearch->index($index)->stats()['numberOfDocuments'];
        } catch (ApiException $e) {
            if ($e->errorCode === 'index_not_found') {
                return 0;
            }

            throw $e;
        }
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
}
