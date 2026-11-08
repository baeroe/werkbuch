<?php

use App\Actions\System\GetSystemStatus;
use App\Models\User;
use App\Search\MeilisearchEngine;
use App\Search\ReportsStatus;
use Laravel\Scout\EngineManager;
use Meilisearch\Client;
use Symfony\Component\Process\Process;
use Tests\Support\Meili;

/*
 * The state of Meilisearch on the system page (Task 11, K15), against the real one: health and the tasks of the indexes
 * of this instance (prefix `testing_` here), enqueued, processing and failed in the last 24 hours.
 */

it('reads the tasks of Meilisearch', function () {
    $client = Meili::use();
    $engine = app(EngineManager::class)->engine();
    expect($engine)->toBeInstanceOf(ReportsStatus::class);

    /** @var ReportsStatus $engine */
    $before = $engine->status();
    expect($before['search'])->toBe('ok')
        ->and($before['search_tasks'])->toBe(['enqueued' => 0, 'processing' => 0, 'failed_last_day' => $before['search_tasks']['failed_last_day']]);

    // a filter on an index that is not there fails (deleting by filter needs the index and its settings)
    $task = $client->index('testing_work_items')->deleteDocuments(['filter' => 'project_id = "nope"']);
    $client->waitForTask($task['taskUid']);
    // a task of an index of another instance does not count
    $other = $client->index('elsewhere_work_items')->deleteDocuments(['filter' => 'project_id = "nope"']);
    $client->waitForTask($other['taskUid']);

    expect($engine->status()['search_tasks']['failed_last_day'])->toBe($before['search_tasks']['failed_last_day'] + 1);
});

it('says down when Meilisearch does not answer', function () {
    $engine = new MeilisearchEngine(app(Client::class), false, 'http://127.0.0.1:1', null);

    expect($engine->status())->toBe(['search' => 'down', 'search_tasks' => null]);
});

it('waits once for Meilisearch and Reverb together (K21)', function () {
    $socket = stream_socket_server('tcp://127.0.0.1:0') ?: throw new RuntimeException('No free port.');
    $port = (int) substr((string) strrchr((string) stream_socket_get_name($socket, false), ':'), 1);
    fclose($socket);

    // five requests of half a second each: asked one after the other they take two and a half seconds, in a pool about one
    $server = new Process([PHP_BINARY, '-S', "127.0.0.1:{$port}", dirname(__DIR__).'/Support/slow-status.php'], null, ['PHP_CLI_SERVER_WORKERS' => '8']);
    $server->start();
    try {
        $until = microtime(true) + 5;
        while (@fsockopen('127.0.0.1', $port) === false) {
            expect(microtime(true) < $until && $server->isRunning())->toBeTrue('The slow server did not start.');
            usleep(20_000);
        }
        config([
            'scout.driver' => 'meilisearch', 'scout.meilisearch.host' => "http://127.0.0.1:{$port}", 'scout.meilisearch.key' => null,
            'broadcasting.default' => 'reverb',
            'broadcasting.connections.reverb.options' => ['scheme' => 'http', 'host' => '127.0.0.1', 'port' => $port],
        ]);
        app(EngineManager::class)->forgetDrivers();
        // the account apart: only the action is measured, its reads of the database and the pool
        $admin = actor(User::factory()->admin()->create());

        $started = microtime(true);
        $status = GetSystemStatus::run($admin);
        $took = microtime(true) - $started;
    } finally {
        $server->stop(0);
    }

    expect($status)->toMatchArray(['search' => 'ok', 'search_tasks' => ['enqueued' => 0, 'processing' => 0, 'failed_last_day' => 0], 'live' => 'ok'])
        ->and($took > 0.45 && $took < 1.8)->toBeTrue(sprintf('The five requests took %.2f s, not between 0.45 s and 1.8 s.', $took));
});
