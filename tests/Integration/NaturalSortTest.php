<?php

use App\Domain\Projects\Identifier;
use App\Domain\Properties\FieldType;
use App\Domain\Views\SortSpec;
use App\Models\Project;
use App\Models\Property;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Support\ItemValues;
use App\Support\PageArgs;
use App\Views\CatalogProperties;
use App\Views\ItemOrder;
use Illuminate\Support\Facades\DB;

/*
 * The natural order of texts and identifiers (Phase 15, Task 21g, A450) against the MariaDB of the app: the list of
 * `resources/js/domain/natural-sort-fixtures.json` is in the order `sort.ts` puts it with `Intl.Collator(…, {numeric:
 * true})` (`sort.test.ts` reads the same file), and the database puts it so with `natural_sort_key()` under the
 * collation of the columns. The list holds only cases in which both agree and no two texts are equal; where they
 * differ (digits of other scripts, fractions) the server decides the pages (A450, report of Task 21g).
 */

/** @return list<string> */
$fixtures = fn (): array => json_decode((string) file_get_contents(repo_path('resources/js/domain/natural-sort-fixtures.json')), true, flags: JSON_THROW_ON_ERROR);

it('orders texts like the browser', function () use ($fixtures) {
    $note = Property::factory()->create(['key' => 'note', 'label' => 'Notiz', 'field_type' => FieldType::Text, 'settings' => []]);
    $task = WorkItemType::query()->where('name', 'Task')->sole();
    $task->typeProperties()->create(['property_id' => $note->id, 'required' => false, 'position' => 0]);
    app()->instance(CatalogProperties::class, CatalogProperties::load());
    $project = Project::factory()->identifier('WEB')->create();

    // created backwards with one rank, so neither the rank nor the ULID gives the order
    foreach (array_reverse($fixtures()) as $text) {
        $item = WorkItem::factory()->create(['project_id' => $project->id, 'type_id' => $task->id, 'title' => $text, 'rank' => 'a0']);
        ItemValues::store($item, ['note' => $text], []);
    }
    $titles = fn (string $field, bool $desc) => ItemOrder::apply(WorkItem::query(), new SortSpec($field, $desc))->pluck('title')->all();

    expect($titles('property:note', false))->toBe($fixtures())
        ->and($titles('property:note', true))->toBe(array_reverse($fixtures()));
});

it('orders identifiers like the browser', function () use ($fixtures) {
    $identifiers = array_values(array_filter($fixtures(), fn (string $text) => Identifier::isValid($text)));
    foreach (array_reverse($identifiers) as $identifier) {
        WorkItem::factory()->create(['project_id' => Project::factory()->identifier($identifier)->create()->id, 'title' => $identifier]);
    }

    expect($identifiers)->toHaveCount(6)
        ->and(ItemOrder::apply(WorkItem::query(), new SortSpec('key', false))->pluck('title')->all())->toBe($identifiers);
});

it('sorts with the whole of a long value on every connection, in UTC', function () {
    $copy = config('database.connections.mariadb');
    config(['database.connections.mariadb_copy' => $copy]);
    $sessions = [DB::connection('mariadb'), DB::connection('mariadb_copy')];

    // MariaDB compares only the first `max_sort_length` bytes in an ORDER BY (1024 by default, about 512 characters
    // under utf8mb4_unicode_ci), a comparison in WHERE the whole value: the keyset of a page then skips or repeats
    foreach ($sessions as $session) {
        expect((int) $session->scalar('select @@session.max_sort_length'))->toBe(65536)
            ->and($session->scalar('select @@session.time_zone'))->toBe('+00:00');
    }
    DB::purge('mariadb_copy');
});

it('pages through texts that share a long beginning, each exactly once, forth and back', function (FieldType $type) {
    $note = Property::factory()->create(['key' => 'note', 'label' => 'Notiz', 'field_type' => $type, 'settings' => []]);
    $task = WorkItemType::query()->where('name', 'Task')->sole();
    $task->typeProperties()->create(['property_id' => $note->id, 'required' => false, 'position' => 0]);
    app()->instance(CatalogProperties::class, CatalogProperties::load());
    $project = Project::factory()->identifier('WEB')->create();
    $common = 'https://example.com/'.str_repeat('x', 600);

    // the rank puts …b first: an ORDER BY that compares only the beginning falls back on it
    foreach (['b' => 'a0', 'a' => 'a1', 'c' => 'a2'] as $end => $rank) {
        $item = WorkItem::factory()->create(['project_id' => $project->id, 'type_id' => $task->id, 'title' => $end, 'rank' => $rank]);
        ItemValues::store($item, ['note' => $common.$end], []);
    }
    $order = new SortSpec('property:note', false);

    $forth = [];
    $cursor = null;
    do {
        $page = ItemOrder::page(WorkItem::query(), $order, new PageArgs($cursor, 1));
        array_push($forth, ...$page->getCollection()->pluck('title')->all());
        $cursor = $page->nextCursor()?->encode();
    } while ($cursor !== null && count($forth) < 6);

    $back = [];
    $cursor = $page->previousCursor()?->encode();
    while ($cursor !== null && count($back) < 6) {
        $page = ItemOrder::page(WorkItem::query(), $order, new PageArgs($cursor, 1));
        array_unshift($back, ...$page->getCollection()->pluck('title')->all());
        $cursor = $page->previousCursor()?->encode();
    }

    expect($forth)->toBe(['a', 'b', 'c'])
        ->and($back)->toBe(['a', 'b']);
})->with([FieldType::Text, FieldType::Url]);
