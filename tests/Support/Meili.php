<?php

namespace Tests\Support;

use Laravel\Scout\EngineManager;
use Meilisearch\Client;
use Meilisearch\Contracts\TasksQuery;
use RuntimeException;

/**
 * Real Meilisearch for tests/Integration (the DDEV service, the CI service). Only the indexes of the tests (prefix
 * `testing_` from phpunit.xml) are touched, never those of the app. Meilisearch works its tasks off asynchronously:
 * after every write, settle() before reading.
 */
final class Meili
{
    /** @var list<string> */
    public const INDEXES = ['testing_work_items', 'testing_projects', 'testing_users'];

    /**
     * Switches Scout to Meilisearch and starts from empty indexes.
     */
    public static function use(): Client
    {
        config(['scout.driver' => 'meilisearch']);
        app(EngineManager::class)->forgetDrivers();

        $client = app(Client::class);
        foreach (self::INDEXES as $index) {
            $client->deleteIndex($index);
        }
        self::settle();

        return $client;
    }

    /**
     * Waits until no task of the test indexes is enqueued or processing, at most 10 s.
     */
    public static function settle(): void
    {
        $query = (new TasksQuery)->setStatuses(['enqueued', 'processing'])->setIndexUids(self::INDEXES);
        $until = microtime(true) + 10;

        while (($open = app(Client::class)->getTasks($query)->getResults()) !== []) {
            if (microtime(true) > $until) {
                throw new RuntimeException('Meilisearch did not settle within 10 s: '.json_encode($open));
            }

            usleep(20_000);
        }
    }

    /**
     * The ids of the documents of an index that a query finds (with a filter in Meilisearch's syntax), in its order.
     *
     * @return list<string>
     */
    public static function ids(string $index, string $q, ?string $filter = null): array
    {
        $hits = app(Client::class)->index($index)->search($q, $filter === null ? [] : ['filter' => $filter])->getHits();

        return array_values(array_map(fn (array $hit) => (string) $hit['id'], $hits));
    }
}
