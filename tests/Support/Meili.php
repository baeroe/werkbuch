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
    /** The four indexes of the tests and the indexes a rebuild fills beside them (SearchIndexer::buildNext()). */
    public const INDEXES = [
        'testing_work_items', 'testing_pages', 'testing_projects', 'testing_users',
        'testing_work_items_next', 'testing_pages_next', 'testing_projects_next', 'testing_users_next',
    ];

    /** The prefix of the indexes of the tests (phpunit.xml): use() refuses to delete indexes under any other (K14). */
    public const PREFIX = 'testing_';

    /** The uid of the newest failed task of the test indexes that settle() has looked at already (or found before use()). */
    private static int $checked = -1;

    /**
     * Switches Scout to Meilisearch and starts from empty indexes; only under the prefix of the tests, so it never
     * deletes the indexes of the app (K14).
     */
    public static function use(): Client
    {
        if (config('scout.prefix') !== self::PREFIX) {
            throw new RuntimeException(sprintf('Meili::use() needs the prefix %s, not "%s".', self::PREFIX, config('scout.prefix')));
        }

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
        $swaps = (new TasksQuery)->setStatuses(['enqueued', 'processing'])->setTypes(['indexSwap']);
        $until = microtime(true) + 10;

        while (($open = [...app(Client::class)->getTasks($query)->getResults(), ...self::ofTests(app(Client::class)->getTasks($swaps)->getResults())]) !== []) {
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
        // a swap names its indexes only in its details (indexUid null): Meilisearch never finds it by indexUids
        $swaps = (new TasksQuery)->setStatuses(['failed'])->setTypes(['indexSwap'])->setLimit(100);

        /** @var list<array{uid: int, indexUid: string, type: string, error: array{code: string, message: string}, details?: array{swaps?: list<array{indexes: list<string>}>}}> $tasks */
        $tasks = [
            ...app(Client::class)->getTasks($query)->getResults(),
            ...self::ofTests(app(Client::class)->getTasks($swaps)->getResults()),
        ];
        usort($tasks, fn (array $a, array $b) => $b['uid'] <=> $a['uid']);

        return array_values(array_map(fn (array $task) => [...$task, 'indexUid' => $task['indexUid'] ?? 'swap'], $tasks));
    }

    /**
     * The swap tasks among these that name an index of the tests: a swap names its indexes only in its details.
     *
     * @param  array<int, array<string, mixed>>  $tasks
     * @return list<array<string, mixed>>
     */
    private static function ofTests(array $tasks): array
    {
        return array_values(array_filter($tasks, fn (array $task) => array_intersect(
            array_merge(...array_column($task['details']['swaps'] ?? [], 'indexes')), self::INDEXES,
        ) !== []));
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
