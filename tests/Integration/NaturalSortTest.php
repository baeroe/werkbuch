<?php

use App\Domain\Projects\Identifier;
use App\Domain\Properties\FieldType;
use App\Domain\Views\SortSpec;
use App\Models\Project;
use App\Models\Property;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Support\ItemValues;
use App\Views\CatalogProperties;
use App\Views\ItemOrder;

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
