<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Models\Comment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Search\MeilisearchEngine;
use App\Search\SearchIndexer;
use Database\Seeders\Load\LoadItems;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Scout\EngineManager;
use Meilisearch\Client;
use Meilisearch\Contracts\TasksQuery;
use Tests\Load\LoadWorld;
use Tests\Load\Support\Budget;

/*
 * The search against 50 000 items (plan, Task 11b; K9). The palette asks 150 ms after the last key, so an answer has its
 * own budget of 0.5 s (median of three runs after a warm-up, Budget::measure, in the table of the suite): one, two and
 * three words, all kinds and only items, for the org admin, who sees the 20 projects, and for a person who sees one.
 * Then the document of the item with 40 comments, and a rebuild of every index at the end (it empties the indexes on
 * the way, so it runs last): within five minutes until Meilisearch has every document, with at most 512 MB of PHP.
 * Meilisearch takes up to two thirds of the RAM while it indexes (A428) and shares the VM in DDEV: the suite runs alone.
 */

/** The budget of one search answer in seconds. */
const SEARCH_SECONDS = 0.5;

/** The budget of a rebuild in seconds, until Meilisearch has written every document (K9). */
const REBUILD_SECONDS = 300;

/** The most memory PHP may hold during a rebuild (memory_get_peak_usage(), from the moment it starts). */
const REBUILD_MEMORY = 512 * 1_048_576;

/**
 * The words of the title of L07-3 (two words of the vocabulary and a verb): one, two and all three of them have hits in
 * L07, the one project of the person below.
 *
 * @return list<string>
 */
$words = function (): array {
    $project = (string) DB::table('projects')->where('identifier', 'L07')->value('id');

    return explode(' ', (string) DB::table('work_items')->where('project_id', $project)->where('number', 3)->value('title'));
};

/**
 * Runs `$measure` as the org admin (20 projects) or as a new person who sees only L07: every project private, the
 * person a member of L07, all in a transaction that is rolled back (the index is not part of it, it needs no change).
 */
$as = function (string $who, Closure $measure): void {
    if ($who === '20 projects') {
        $measure(User::query()->where('handle', 'load-01')->sole());

        return;
    }

    DB::beginTransaction();
    try {
        DB::table('projects')->update(['visibility' => 'private']);
        $person = User::factory()->create(['name' => 'Suchende Person']);
        app(RoleAssignments::class)->setProjectRole($person, Project::query()->where('identifier', 'L07')->sole(), ProjectRole::Member);
        $measure($person);
    } finally {
        DB::rollBack();
    }
};

$cases = [];
foreach (['20 projects', '1 project'] as $who) {
    foreach ([1, 2, 3] as $count) {
        foreach (['all kinds' => '', 'items' => '&types=items'] as $kinds => $types) {
            $name = sprintf('search %d %s, %s, as %s', $count, $count === 1 ? 'word' : 'words', $kinds, $who);
            $cases[$name] = [$name, $who, $count, $types];
        }
    }
}

it('answers a search within half a second', function (string $name, string $who, int $count, string $types) use ($words, $as) {
    LoadWorld::ensure();
    $q = implode(' ', array_slice($words(), 0, $count));

    $as($who, function (User $reader) use ($q, $types, $name, $who): void {
        $median = Budget::measure($name, fn () => $this->actingAs($reader)->getJson('/api/v1/search?q='.rawurlencode($q).$types), SEARCH_SECONDS);

        $answer = Budget::answer();
        expect($answer)->toBeInstanceOf(TestResponse::class);
        $items = $answer->json('data.items');
        $projects = array_values(array_unique(array_column($items, 'project_id')));
        expect($items)->not->toBeEmpty("{$name} found no item");
        if ($who === '1 project') {
            expect($projects)->toBe([(string) DB::table('projects')->where('identifier', 'L07')->value('id')]);
        } else {
            // the admin's hits come from more than the one project
            expect(count($projects))->toBeGreaterThan(1);
        }
        if ($types !== '') {
            expect($answer->json('data.pages'))->toBe([])
                ->and($answer->json('data.projects'))->toBe([]);
        }

        expect($median)->toBeLessThanOrEqual(SEARCH_SECONDS, sprintf('%s took %.0f ms (median)', $name, $median * 1_000));
    });
})->with($cases);

it('keeps the document of the item with 40 comments within COMMENTS_MAX', function () {
    LoadWorld::ensure();
    $project = (string) DB::table('projects')->where('identifier', 'L07')->value('id');
    $busy = WorkItem::query()->where('project_id', $project)->where('number', LoadItems::BUSY)->sole();
    $texts = Comment::query()->where('work_item_id', $busy->id)->orderBy('created_at')->orderBy('id')->pluck('body_text')->all();

    $document = app(Client::class)->index((new WorkItem)->searchableAs())->getDocument($busy->id);
    fwrite(STDERR, sprintf("\nThe document of %s (%d comments) holds %d bytes of comment text.\n", $busy->key, count($texts), strlen($document['comments'])));

    expect($texts)->toHaveCount(40)
        ->and($document['comments'])->toBe(SearchIndexer::commentsText(array_values($texts)))
        ->and(strlen($document['comments']))->toBeLessThanOrEqual(SearchIndexer::COMMENTS_MAX);
});

it('rebuilds the index of 50 000 items within five minutes', function () {
    LoadWorld::ensure();
    $since = app(Client::class)->getTasks((new TasksQuery)->setLimit(1))->getResults()[0]['uid'] ?? -1;
    $before = memory_get_usage();
    memory_reset_peak_usage();

    $started = hrtime(true);
    $counts = app(SearchIndexer::class)->rebuild();
    $written = (hrtime(true) - $started) / 1e9;
    $peak = memory_get_peak_usage();
    LoadWorld::settle($since);
    $settled = (hrtime(true) - $started) / 1e9;

    /** @var MeilisearchEngine $engine */
    $engine = app(EngineManager::class)->engine();
    $documents = $engine->documentStats((new WorkItem)->searchableAs())['documents'];
    fwrite(STDERR, sprintf(
        "\nThe rebuild wrote %s in %.1f s, Meilisearch had every document after %.1f s; PHP held %.0f MB before and peaked at %.0f MB.\n",
        json_encode($counts), $written, $settled, $before / 1_048_576, $peak / 1_048_576,
    ));

    expect($counts['work_items'])->toBe(50_000)
        ->and($documents)->toBe(50_000)
        ->and($settled)->toBeLessThanOrEqual(REBUILD_SECONDS, sprintf('the rebuild took %.1f s', $settled))
        ->and($peak)->toBeLessThanOrEqual(REBUILD_MEMORY);
});
