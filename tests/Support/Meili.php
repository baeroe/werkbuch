<?php

namespace Tests\Support;

use Laravel\Scout\EngineManager;
use Meilisearch\Client;
use Meilisearch\Contracts\TasksQuery;
use RuntimeException;

/**
 * Real Meilisearch for tests/Integration (the DDEV service, the CI service). Only the indexes of the tests (prefix
 * `testing_` from phpunit.xml) are touched, never those of the app. Meilisearch works its tasks off asynchronously:
 * after every write, settle() before reading; it also throws when Meilisearch failed one of them (a filter on an
 * attribute that is not filterable, settings it refuses), which would otherwise only show as a missing effect.
 */
final class Meili
{
    /** @var list<string> */
    public const INDEXES = ['testing_work_items', 'testing_projects', 'testing_users'];

    /** The uid of the newest failed task of the test indexes that settle() has looked at already (or found before use()). */
    private static int $checked = -1;

    /**
     * Switches Scout to Meilisearch and starts from empty indexes.
     */
    public static function use(): Client
    {
        config(['scout.driver' => 'meilisearch']);
        app(EngineManager::class)->forgetDrivers();

        $client = app(Client::class);
        self::wait();
        self::$checked = max(self::$checked, self::failedTasks()[0]['uid'] ?? -1);   // failures of earlier runs are not ours

        foreach (self::INDEXES as $index) {
            $client->deleteIndex($index);
        }
        self::settle();

        return $client;
    }

    /**
     * Waits until no task of the test indexes is enqueued or processing, at most 10 s, and throws when one of the tasks
     * since the last call failed. Deleting an index that is not there (use()) is no failure: it is gone, as wanted.
     */
    public static function settle(): void
    {
        self::wait();

        $failed = array_filter(self::failedTasks(), fn (array $task) => $task['uid'] > self::$checked);
        self::$checked = max([self::$checked, ...array_column($failed, 'uid')]);
        $failed = array_filter($failed, fn (array $task) => ! ($task['type'] === 'indexDeletion' && $task['error']['code'] === 'index_not_found'));

        if ($failed !== []) {
            throw new RuntimeException('Meilisearch failed a task of the test indexes: '.json_encode(array_map(
                fn (array $task) => ['index' => $task['indexUid'], 'type' => $task['type'], 'error' => $task['error']],
                array_values($failed),
            )));
        }
    }

    private static function wait(): void
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
     * The failed tasks of the test indexes, newest first (at most 100: more than that between two calls never happen).
     *
     * @return list<array{uid: int, indexUid: string, type: string, error: array{code: string, message: string}}>
     */
    private static function failedTasks(): array
    {
        $query = (new TasksQuery)->setStatuses(['failed'])->setIndexUids(self::INDEXES)->setLimit(100);

        /** @var list<array{uid: int, indexUid: string, type: string, error: array{code: string, message: string}}> */
        return app(Client::class)->getTasks($query)->getResults();
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
