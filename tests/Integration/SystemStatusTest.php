<?php

use App\Search\MeilisearchEngine;
use App\Search\ReportsStatus;
use Laravel\Scout\EngineManager;
use Meilisearch\Client;
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
    $engine = new MeilisearchEngine(app(Client::class), false, new Client('http://127.0.0.1:1'));

    expect($engine->status())->toBe(['search' => 'down', 'search_tasks' => null]);
});
