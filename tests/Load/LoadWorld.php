<?php

namespace Tests\Load;

use Database\Seeders\LoadSeeder;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Meilisearch\Client;
use Meilisearch\Contracts\TasksQuery;
use RuntimeException;
use Spatie\Permission\PermissionRegistrar;
use Throwable;

/**
 * The database `load` of the load suite (K8). ensure() checks first that the connection is `load` and the search
 * prefix `load_` and stops before any statement otherwise; then it migrates (a seeded database gets the migrations of
 * later tasks) and seeds anew when `load_meta` lacks the version of LoadSeeder or its numbers. Once per process; tests
 * change no data except in transactions they roll back.
 */
final class LoadWorld
{
    /** The search indexes of the load data (the tables, with the prefix `load_`) and those a rebuild fills beside them. */
    public const INDEXES = [
        'load_work_items', 'load_pages', 'load_projects', 'load_users',
        'load_work_items_next', 'load_pages_next', 'load_projects_next', 'load_users_next',
    ];

    /** How long settle() waits for Meilisearch: a full import of 50 000 items with their comments takes minutes. */
    public const SETTLE_SECONDS = 900;

    private static bool $ready = false;

    public static function ensure(): void
    {
        // before anything else: never a statement against another database or another index (K8)
        LoadSeeder::guard();

        if (self::$ready) {
            return;
        }

        Artisan::call('migrate', ['--force' => true]);

        if (! self::seeded()) {
            self::seed();
        }

        self::$ready = true;
    }

    /** The next ensure() migrates and checks the data again, as a new process would. */
    public static function forget(): void
    {
        self::$ready = false;
    }

    /**
     * Waits until Meilisearch has no open task of the load indexes, and throws when one of the tasks after `$since`
     * (a task uid) failed.
     */
    public static function settle(int $since = -1): void
    {
        $client = app(Client::class);
        $open = (new TasksQuery)->setStatuses(['enqueued', 'processing'])->setIndexUids(self::INDEXES);
        $until = microtime(true) + self::SETTLE_SECONDS;

        while (($tasks = $client->getTasks($open)->getResults()) !== []) {
            if (microtime(true) > $until) {
                throw new RuntimeException('Meilisearch did not settle within '.self::SETTLE_SECONDS.' s: '.count($tasks).' tasks open.');
            }

            usleep(250_000);
        }

        // a swap (SearchIndexer::swapIn()) names its indexes only in its details: Meilisearch never finds it by indexUids
        $swaps = array_filter(
            $client->getTasks((new TasksQuery)->setStatuses(['failed'])->setTypes(['indexSwap'])->setLimit(100))->getResults(),
            fn (array $task) => array_intersect(array_merge(...array_column($task['details']['swaps'] ?? [], 'indexes')), self::INDEXES) !== [],
        );
        $failed = array_filter(
            [...$client->getTasks((new TasksQuery)->setStatuses(['failed'])->setIndexUids(self::INDEXES)->setLimit(100))->getResults(), ...$swaps],
            fn (array $task) => $task['uid'] > $since && ! ($task['type'] === 'indexDeletion' && $task['error']['code'] === 'index_not_found'),
        );

        if ($failed !== []) {
            throw new RuntimeException('Meilisearch failed a task of the load indexes: '.json_encode(array_map(
                fn (array $task) => ['index' => $task['indexUid'], 'type' => $task['type'], 'error' => $task['error']],
                array_values($failed),
            )));
        }
    }

    private static function seeded(): bool
    {
        if (! Schema::hasTable('load_meta')) {
            return false;
        }

        $meta = DB::table('load_meta')->pluck('value', 'name');
        if ($meta->get('version') !== (string) LoadSeeder::VERSION) {
            return false;
        }

        foreach (LoadSeeder::COUNTED as $table) {
            if (! is_numeric($meta->get($table))) {
                return false;
            }
        }

        return true;
    }

    private static function seed(): void
    {
        $since = app(Client::class)->getTasks((new TasksQuery)->setLimit(1))->getResults()[0]['uid'] ?? -1;
        $started = microtime(true);
        // the organization, roles and permissions of the database before go, before migrate:fresh as after it: on an
        // empty database ensure() migrated first, and the default bot of the fresh migrations took its role in the team
        // of that organization (Organization::current() is scoped), so it saw no private project
        self::forgetOrganization();
        Artisan::call('migrate:fresh', ['--force' => true]);
        self::forgetOrganization();
        $migrated = microtime(true);

        try {
            Artisan::call('db:seed', ['--class' => LoadSeeder::class, '--force' => true]);
            $seeded = microtime(true);
            self::settle($since);

            LoadSeeder::meta([
                'migrate_seconds' => round($migrated - $started, 1),
                'settle_seconds' => round(microtime(true) - $seeded, 1),
            ]);
        } catch (Throwable $e) {
            // a half seeded database is seeded again next time
            if (Schema::hasTable('load_meta')) {
                DB::table('load_meta')->delete();
            }

            throw $e;
        }
    }

    /** The scoped organization, role index and catalog of the container and the permissions spatie holds. */
    private static function forgetOrganization(): void
    {
        app()->forgetScopedInstances();
        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
