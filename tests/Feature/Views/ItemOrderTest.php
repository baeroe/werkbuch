<?php

use App\Actions\Favorites\ListFavorites;
use App\Actions\Favorites\ToggleFavorite;
use App\Domain\Filter\FilterSchema;
use App\Domain\Properties\FieldType;
use App\Domain\Views\SortSpec;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\Priority;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Models\WorkItemValue;
use App\Support\ItemValues;
use App\Support\ListResult;
use App\Support\PageArgs;
use App\Views\CatalogProperties;
use App\Views\FilterQuery;
use App\Views\ItemOrder;
use Illuminate\Pagination\CursorPaginator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/*
 * The order of item lists and its keyset cursor. The first cases are those of `sortItems` in
 * `src/domain/filter.test.ts` of the clickdummy, with the same names; then every sort pages through a world of many
 * ties and empty values, forwards and backwards, and a cursor of anything else is refused.
 */

beforeEach(function () {
    $this->type = fn (string $name): WorkItemType => WorkItemType::query()->where('name', $name)->sole();
    $this->state = fn (string $name): string => WorkflowState::query()->where('workflow_id', Workflow::default()->id)->where('name', $name)->sole()->id;
    // the properties of the organisation as this test made them (the container holds them once per request)
    $this->catalog = fn () => app()->instance(CatalogProperties::class, CatalogProperties::load());
    $this->titles = fn (SortSpec $sort): array => ItemOrder::apply(WorkItem::query(), $sort)->get()->pluck('title')->all();
    $this->web = Project::factory()->identifier('WEB')->create();
});

/** The sort of a field and a direction. */
$sort = fn (string $field, string $direction = 'asc'): SortSpec => new SortSpec($field, $direction === 'desc');

/**
 * Properties of every type a list sorts by, for Task: the built-in effort (number), a release day, a customer
 * reference (text) and a ticket address; Bug has only the effort, Epic none of them.
 */
$properties = function (): array {
    $make = fn (string $key, FieldType $type) => Property::factory()->create(['key' => $key, 'label' => $key, 'field_type' => $type, 'settings' => []]);
    $properties = [
        'effort' => Property::query()->where('key', 'effort')->sole(),
        'release' => $make('release', FieldType::Date),
        'customer_ref' => $make('customer_ref', FieldType::Text),
        'ticket_url' => $make('ticket_url', FieldType::Url),
    ];
    foreach ([['Task', array_keys($properties)], ['Bug', ['effort']], ['Epic', []]] as [$name, $keys]) {
        $type = WorkItemType::query()->where('name', $name)->sole();
        $type->typeProperties()->delete();
        foreach ($keys as $position => $key) {
            $type->typeProperties()->create(['property_id' => $properties[$key]->id, 'required' => false, 'position' => $position]);
        }
    }

    return $properties;
};

/** The ULIDs of every page of the sort, following `next_cursor`, as pages. */
$forward = function (SortSpec $sort, int $perPage): array {
    $pages = [];
    $cursor = null;
    do {
        $page = ItemOrder::page(WorkItem::query(), $sort, new PageArgs($cursor, $perPage));
        $pages[] = ['ids' => $page->pluck('id')->all(), 'page' => $page];
        $cursor = $page->nextCursor()?->encode();
    } while ($cursor !== null && count($pages) <= 100);

    return $pages;
};

/** The ULIDs of the pages before the one given, following `prev_cursor`, nearest first. */
$backward = function (SortSpec $sort, CursorPaginator $from, int $perPage): array {
    $pages = [];
    $cursor = $from->previousCursor()?->encode();
    while ($cursor !== null && count($pages) <= 100) {
        $page = ItemOrder::page(WorkItem::query(), $sort, new PageArgs($cursor, $perPage));
        $pages[] = $page->pluck('id')->all();
        $cursor = $page->previousCursor()?->encode();
    }

    return $pages;
};

/** A cursor of the sort after its first page of two, decoded, changed by the callback and encoded again. */
$tampered = function (SortSpec $sort, callable $change): string {
    $page = ItemOrder::page(WorkItem::query(), $sort, new PageArgs(null, 2));
    $parameters = json_decode((string) base64_decode(strtr((string) $page->nextCursor()?->encode(), '-_', '+/')), true);

    return str_replace(['+', '/', '='], ['-', '_', ''], base64_encode((string) json_encode($change($parameters))));
};

$refused = function (callable $call): void {
    try {
        $call();
        test()->fail('the cursor went through');
    } catch (ValidationException $e) {
        expect($e->errors())->toBe(['cursor' => [__('field.cursor.invalid')]]);
    }
};

it('sorts by rank in code-unit order, not by locale', function () use ($sort) {
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'b', 'rank' => 'a1']);
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'c', 'rank' => 'Zz']);
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'a', 'rank' => 'a0']);

    // capital letters sort before lower case ones, which is what fractional indexing relies on
    expect(($this->titles)($sort('rank')))->toBe(['c', 'a', 'b'])
        ->and(($this->titles)($sort('rank', 'desc')))->toBe(['b', 'a', 'c']);
});

it('puts the most urgent priority first when ascending', function () use ($sort) {
    foreach (['none' => 'a0', 'low' => 'a1', 'urgent' => 'a2', 'medium' => 'a3', 'high' => 'a4'] as $priority => $rank) {
        WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => $priority, 'priority' => Priority::from($priority), 'rank' => $rank]);
    }

    expect(($this->titles)($sort('priority')))->toBe(['urgent', 'high', 'medium', 'low', 'none'])
        ->and(($this->titles)($sort('priority', 'desc')))->toBe(['none', 'low', 'medium', 'high', 'urgent']);
});

it('sorts dates and keeps items without a date last in both directions', function () use ($sort) {
    foreach ([['none', null, 'a0'], ['late', '2026-11-20', 'a1'], ['early', '2026-10-30', 'a2']] as [$title, $day, $rank]) {
        WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => $title, 'due_date' => $day, 'start_date' => $day, 'rank' => $rank]);
    }

    expect(($this->titles)($sort('due_date')))->toBe(['early', 'late', 'none'])
        ->and(($this->titles)($sort('due_date', 'desc')))->toBe(['late', 'early', 'none'])
        ->and(($this->titles)($sort('start_date')))->toBe(['early', 'late', 'none'])
        ->and(($this->titles)($sort('start_date', 'desc')))->toBe(['late', 'early', 'none']);
});

it('breaks ties by the manual order', function () use ($sort) {
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'second', 'due_date' => '2026-10-30', 'rank' => 'a1']);
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'first', 'due_date' => '2026-10-30', 'rank' => 'a0']);

    expect(($this->titles)($sort('due_date')))->toBe(['first', 'second'])
        ->and(($this->titles)($sort('due_date', 'desc')))->toBe(['first', 'second']);
});

it('replaces an order the query brings, for the list and for a page', function () use ($sort) {
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'late', 'due_date' => '2026-10-31', 'rank' => 'a0']);
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'early', 'due_date' => '2026-10-29', 'rank' => 'a1']);
    $ordered = fn () => WorkItem::query()->orderBy('work_items.rank')->orderByDesc('work_items.title');

    $first = ItemOrder::page($ordered(), $sort('due_date'), new PageArgs(null, 1));
    $second = ItemOrder::page($ordered(), $sort('due_date'), new PageArgs($first->nextCursor()?->encode(), 1));

    expect(ItemOrder::apply($ordered(), $sort('due_date'))->pluck('title')->all())->toBe(['early', 'late'])
        ->and($first->pluck('title')->all())->toBe(['early'])
        ->and($second->pluck('title')->all())->toBe(['late']);
});

it('sorts keys naturally: by project, then by number', function () use ($sort) {
    $app = Project::factory()->identifier('APP')->create();
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'WEB-10', 'number' => 10]);
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'WEB-9', 'number' => 9]);
    WorkItem::factory()->create(['project_id' => $app->id, 'title' => 'APP-5', 'number' => 5]);

    expect(($this->titles)($sort('key')))->toBe(['APP-5', 'WEB-9', 'WEB-10'])
        ->and(($this->titles)($sort('key', 'desc')))->toBe(['WEB-10', 'WEB-9', 'APP-5']);
});

it('sorts identifiers with digits naturally (A450, T8-M7)', function () use ($sort) {
    // by the collation A10 came before A2 and WEB10 before WEB2
    foreach (['A10', 'WEB2', 'A2', 'WEB10'] as $identifier) {
        WorkItem::factory()->create(['project_id' => Project::factory()->identifier($identifier)->create()->id, 'title' => "{$identifier}-1"]);
    }
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'WEB-1']);

    expect(($this->titles)($sort('key')))->toBe(['A2-1', 'A10-1', 'WEB-1', 'WEB2-1', 'WEB10-1'])
        ->and(($this->titles)($sort('key', 'desc')))->toBe(['WEB10-1', 'WEB2-1', 'WEB-1', 'A10-1', 'A2-1']);
});

it('sorts by creation and change time', function () use ($sort) {
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'new', 'created_at' => '2026-10-27 10:00:00', 'updated_at' => '2026-10-27 10:00:00']);
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'old', 'created_at' => '2026-10-01 10:00:00', 'updated_at' => '2026-10-28 09:00:00']);

    expect(($this->titles)($sort('created_at')))->toBe(['old', 'new'])
        ->and(($this->titles)($sort('updated_at', 'desc')))->toBe(['old', 'new'])
        ->and(($this->titles)($sort('created_at', 'desc')))->toBe(['new', 'old'])
        ->and(($this->titles)($sort('updated_at')))->toBe(['new', 'old']);
});

it('sorts by created_at without a guard', function () use ($sort) {
    // the stamps are required (A440): the order and the keyset compare the column itself, so its index serves the range
    $items = WorkItem::factory()->count(3)->create(['project_id' => $this->web->id]);
    foreach ($items as $i => $item) {
        DB::table('work_items')->where('id', $item->id)->update(['created_at' => sprintf('2026-10-%02d 08:00:00', $i + 1), 'updated_at' => sprintf('2026-10-%02d 09:00:00', $i + 1)]);
    }

    foreach (['created_at', 'updated_at'] as $field) {
        foreach (['asc', 'desc'] as $direction) {
            $first = ItemOrder::page(WorkItem::query(), $sort($field, $direction), new PageArgs(null, 1));
            DB::flushQueryLog();
            DB::enableQueryLog();
            $second = ItemOrder::page(WorkItem::query(), $sort($field, $direction), new PageArgs($first->nextCursor()?->encode(), 1));
            DB::disableQueryLog();
            $sql = DB::getQueryLog()[0]['query'];
            $operator = $direction === 'desc' ? '<' : '>';

            expect($sql)->not->toContain('coalesce')
                ->and($sql)->not->toContain('is null')
                ->and($sql)->toContain("`work_items`.`{$field}` {$operator} ?")
                ->and($first->nextCursor()?->parameters(['sort_0']))->toBe([$first->first()?->getRawOriginal($field)])
                ->and($second->pluck('id')->all())->toBe([$items[1]->id], "{$field} {$direction}");
        }
    }
});

it('refuses a cursor of the old shape', function () use ($sort, $refused) {
    // before A440 a stamp had the mark of an empty value and the value with a guard (`sort_0`, `sort_1`)
    $items = WorkItem::factory()->count(3)->create(['project_id' => $this->web->id]);
    $old = fn (string $signature) => str_replace(['+', '/', '='], ['-', '_', ''], base64_encode((string) json_encode([
        'sort_0' => 0, 'sort_1' => '2026-10-01 08:00:00', 'rank' => $items[0]->rank, 'id' => $items[0]->id,
        '_sig' => $signature, '_pointsToNextItems' => true,
    ])));

    foreach (['created_at', 'updated_at'] as $field) {
        foreach (['asc', 'desc'] as $direction) {
            $order = $sort($field, $direction);
            $refused(fn () => ItemOrder::page(WorkItem::query(), $order, new PageArgs($old($order->signature()), 1)));
        }
    }
});

it('sorts number, date and text properties', function () use ($sort, $properties) {
    $properties();
    ($this->catalog)();
    $task = fn (string $title, array $values) => tap(
        WorkItem::factory()->create(['project_id' => $this->web->id, 'type_id' => ($this->type)('Task')->id, 'title' => $title, 'rank' => 'a0']),
        fn (WorkItem $item) => ItemValues::store($item, $values, []),
    );
    $c = $task('c', ['effort' => 10, 'release' => '2026-12-01', 'customer_ref' => 'Safari']);
    // only the first value counts (a row behind it, which only a multiple choice has, does not)
    WorkItemValue::query()->create(['work_item_id' => $c->id, 'property_id' => Property::query()->where('key', 'effort')->value('id'), 'position' => 1, 'value_number' => '-100']);
    $task('a', ['effort' => 2.5, 'release' => '2026-10-01', 'customer_ref' => 'chrome']);
    $task('b', ['customer_ref' => 'Ärger']);
    $task('d', ['effort' => -1, 'release' => '2026-11-01']);
    // an epic does not have the properties: its values (left from a type it once had) count as none
    $epic = WorkItem::factory()->create(['project_id' => $this->web->id, 'type_id' => ($this->type)('Epic')->id, 'title' => 'epic', 'rank' => 'a0']);
    ItemValues::store($epic, ['effort' => 1, 'release' => '2026-01-01', 'customer_ref' => 'Aal'], []);

    // numbers compare as numbers (2.5 before 10), a missing value comes last, in both directions, then by rank and id
    $rest = WorkItem::query()->whereIn('title', ['b', 'epic'])->orderBy('id')->pluck('title')->all();
    expect(($this->titles)($sort('property:effort')))->toBe(['d', 'a', 'c', ...$rest])
        ->and(($this->titles)($sort('property:effort', 'desc')))->toBe(['c', 'a', 'd', ...$rest])
        ->and(($this->titles)($sort('property:release')))->toBe(['a', 'd', 'c', ...$rest])
        ->and(($this->titles)($sort('property:release', 'desc')))->toBe(['c', 'd', 'a', ...$rest]);

    // text compares without regard to case and accents: Ärger, chrome, Safari
    $none = WorkItem::query()->whereIn('title', ['d', 'epic'])->orderBy('id')->pluck('title')->all();
    expect(($this->titles)($sort('property:customer_ref')))->toBe(['b', 'a', 'c', ...$none])
        ->and(($this->titles)($sort('property:customer_ref', 'desc')))->toBe(['c', 'a', 'b', ...$none]);
});

it('sorts a text property naturally (A450)', function () use ($sort, $properties) {
    $properties();
    ($this->catalog)();
    $task = fn (string $title, array $values) => tap(
        WorkItem::factory()->create(['project_id' => $this->web->id, 'type_id' => ($this->type)('Task')->id, 'title' => $title, 'rank' => 'a0']),
        fn (WorkItem $item) => ItemValues::store($item, $values, []),
    );
    // created against the natural order, so neither rank nor ULID puts them right
    $task('100', ['customer_ref' => 'Item 100', 'ticket_url' => 'https://a.example.com/100']);
    $task('11', ['customer_ref' => 'item 11', 'ticket_url' => 'https://a.example.com/11']);
    $task('10', ['customer_ref' => 'Item 10', 'ticket_url' => 'https://a.example.com/10']);
    $task('9', ['customer_ref' => 'Item 9', 'ticket_url' => 'https://a.example.com/9']);
    $task('2', ['customer_ref' => 'Item 2', 'ticket_url' => 'https://a.example.com/2']);
    $task('none', []);

    foreach (['customer_ref', 'ticket_url'] as $key) {
        expect(($this->titles)($sort("property:{$key}")))->toBe(['2', '9', '10', '11', '100', 'none'], $key)
            ->and(($this->titles)($sort("property:{$key}", 'desc')))->toBe(['100', '11', '10', '9', '2', 'none'], $key);
    }
});

it('pages a natural sort exactly once', function () use ($sort, $properties, $forward, $backward) {
    $properties();
    ($this->catalog)();
    $task = ($this->type)('Task')->id;
    // numbers of one to three digits, equal texts in another case (a tie the rank and the ULID decide) and no value
    $expected = [];
    foreach (range(30, 1) as $n) {
        $item = WorkItem::factory()->create(['project_id' => $this->web->id, 'type_id' => $task, 'rank' => $n % 3 === 0 ? 'a0' : 'a1']);
        $text = $n % 7 === 0 ? null : ($n % 2 === 0 ? 'item ' : 'Item ').(intdiv($n, 2) * ($n % 8 < 2 ? 10 : 1));
        ItemValues::store($item, array_filter(['customer_ref' => $text]), []);
        $expected[] = ['id' => $item->id, 'rank' => $item->rank, 'text' => $text];
    }
    usort($expected, fn (array $a, array $b) => [$a['text'] === null, $a['text'] === null ? 0 : (int) explode(' ', $a['text'])[1], $a['rank'], $a['id']]
        <=> [$b['text'] === null, $b['text'] === null ? 0 : (int) explode(' ', $b['text'])[1], $b['rank'], $b['id']]);
    $order = $sort('property:customer_ref');

    expect(ItemOrder::apply(WorkItem::query(), $order)->get()->pluck('id')->all())->toBe(array_column($expected, 'id'));
    foreach ([1, 2, 7] as $perPage) {
        $pages = $forward($order, $perPage);
        $last = end($pages)['page'];

        // every page but the last is full, and together they are every item once, in the natural order
        expect(array_merge(...array_column($pages, 'ids')))->toBe(array_column($expected, 'id'), "forward, {$perPage} per page")
            ->and(array_map('count', array_column(array_slice($pages, 0, -1), 'ids')))->each->toBe($perPage)
            ->and($backward($order, $last, $perPage))->toBe(array_reverse(array_column(array_slice($pages, 0, -1), 'ids')), "backward, {$perPage} per page");
    }
});

it('refuses a cursor of a text or key sort from before the natural order', function () use ($sort, $properties, $refused) {
    $properties();
    ($this->catalog)();
    foreach (range(1, 3) as $n) {
        $item = WorkItem::factory()->create(['project_id' => $this->web->id, 'type_id' => ($this->type)('Task')->id, 'rank' => 'a0']);
        ItemValues::store($item, ['customer_ref' => "Item {$n}"], []);
    }
    $item = WorkItem::query()->orderBy('id')->firstOrFail();
    // the value as the collation compared it, under the signature of the sort alone
    $old = fn (SortSpec $order, array $values) => str_replace(['+', '/', '='], ['-', '_', ''], base64_encode((string) json_encode([
        ...$values, 'rank' => $item->rank, 'id' => $item->id, '_sig' => $order->signature(), '_pointsToNextItems' => true,
    ])));

    foreach (['asc', 'desc'] as $direction) {
        $text = $sort('property:customer_ref', $direction);
        $key = $sort('key', $direction);
        $refused(fn () => ItemOrder::page(WorkItem::query(), $text, new PageArgs($old($text, ['sort_0' => 0, 'sort_1' => 'Item 1']), 1)));
        $refused(fn () => ItemOrder::page(WorkItem::query(), $key, new PageArgs($old($key, ['sort_0' => 'WEB', 'sort_1' => 1]), 1)));
    }
});

it('sorts by the category of the status', function () use ($sort) {
    foreach ([['done', 'Done', 'a0'], ['progress', 'In Progress', 'a1'], ['backlog', 'Backlog', 'a2']] as [$title, $state, $rank]) {
        WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => $title, 'state_id' => ($this->state)($state), 'rank' => $rank]);
    }

    expect(($this->titles)($sort('state_category')))->toBe(['backlog', 'progress', 'done'])
        ->and(($this->titles)($sort('state_category', 'desc')))->toBe(['done', 'progress', 'backlog']);
});

it('falls back to the manual order for a field it does not know', function () use ($sort, $properties) {
    $properties();
    Property::factory()->dropdown(['Nordlicht'])->create(['key' => 'customer', 'label' => 'Kunde']);
    ($this->catalog)();
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'b', 'rank' => 'a1']);
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'a', 'rank' => 'a0']);

    // a property that went, a dropdown (no sort of its own) and a core field that is no sort
    expect(($this->titles)($sort('property:gone')))->toBe(['a', 'b'])
        ->and(($this->titles)($sort('property:customer', 'desc')))->toBe(['a', 'b'])
        ->and(($this->titles)($sort('title', 'desc')))->toBe(['a', 'b'])
        ->and(ItemOrder::page(WorkItem::query(), $sort('nope'), new PageArgs(null, 1))->nextCursor()?->parameters(['rank', 'id', '_sig']))
        ->toBe(['a0', WorkItem::query()->where('title', 'a')->value('id'), 'nope:asc']);
});

/**
 * The world of the paging cases: 60 items in APP, OPS and WEB with many equal ranks (`a0` in every project), equal
 * days and times, all priorities and states, and empty values; Bug has only the effort, an epic none of the
 * properties (and leftover values for some). Returns each item as the keys `sortItems` would read off it.
 */
$world = function (Project $web) use ($properties): array {
    $properties();
    app()->instance(CatalogProperties::class, CatalogProperties::load());
    // identifiers with digits: A2 before A10 only in the natural order
    $projects = [Project::factory()->identifier('A10')->create(), Project::factory()->identifier('A2')->create(), $web];
    $types = ['Task' => WorkItemType::query()->where('name', 'Task')->sole(), 'Bug' => WorkItemType::query()->where('name', 'Bug')->sole(), 'Epic' => WorkItemType::query()->where('name', 'Epic')->sole()];
    $states = WorkflowState::query()->where('workflow_id', Workflow::default()->id)->get()->keyBy('name');
    $pick = fn (array $options, int $i, string $salt) => $options[crc32("{$salt}-{$i}") % count($options)];
    $categories = array_map(fn (StateCategory $c) => $c->value, StateCategory::ORDER);
    $priorities = array_map(fn (Priority $p) => $p->value, Priority::ORDER);
    $days = [null, '2026-11-01', '2026-11-01', '2026-10-30', '2026-12-24'];
    $stamps = ['2026-10-01 08:00:00', '2026-10-01 08:00:00', '2026-10-15 12:30:00', '2026-10-28 23:59:59'];
    $values = [
        'effort' => [null, 2.5, 10, 2.5, 0, -1.5, 10],
        'release' => [null, '2026-11-01', '2026-10-01', '2026-11-01'],
        'customer_ref' => [null, 'Über 10', 'uber 9', 'Uber 9', 'chrome', 'Safari 100', 'Ärger 2'],
        'ticket_url' => [null, 'https://b.example.com/9', 'https://a.example.com/10', 'https://a.example.com/9'],
    ];
    $has = ['Task' => array_keys($values), 'Bug' => ['effort'], 'Epic' => []];

    $rows = [];
    for ($i = 0; $i < 60; $i++) {
        $project = $projects[$i % 3];
        $type = $pick(['Task', 'Task', 'Bug', 'Epic'], $i, 'type');
        $state = $states[$pick(['Backlog', 'Todo', 'In Progress', 'Pending', 'Done', 'Cancelled'], $i, 'state')];
        $item = WorkItem::factory()->create([
            'project_id' => $project->id,
            'type_id' => $types[$type]->id,
            'state_id' => $state->id,
            'rank' => $pick(['a0', 'a0', 'a0', 'a1', 'Zz', 'a0V'], $i, 'rank'),
            'priority' => Priority::from($pick($priorities, $i, 'priority')),
            'due_date' => $pick($days, $i, 'due'),
            'start_date' => $pick($days, $i, 'start'),
            'created_at' => $pick($stamps, $i, 'created'),
            'updated_at' => $pick($stamps, $i, 'updated'),
        ]);
        $given = [];
        foreach ($values as $key => $options) {
            $given[$key] = $pick($options, $i, $key);
        }
        // an epic keeps the values of a type it once had, every third one
        $stored = $type === 'Epic' && $i % 3 === 0 ? $given : array_intersect_key($given, array_flip($has[$type]));
        ItemValues::store($item, array_filter($stored, fn (mixed $value) => $value !== null), []);

        $rows[] = [
            'id' => $item->id,
            'rank' => $item->rank,
            'priority' => array_search($item->priority->value, $priorities, true),
            'due_date' => $item->due_date?->format('Y-m-d'),
            'start_date' => $item->start_date?->format('Y-m-d'),
            'created_at' => $item->created_at?->format('Y-m-d H:i:s'),
            'updated_at' => $item->updated_at?->format('Y-m-d H:i:s'),
            'key' => [$project->identifier, $item->number],
            'state_category' => array_search($state->category->value, $categories, true),
            'values' => array_merge(array_fill_keys(array_keys($values), null), array_intersect_key($given, array_flip($has[$type]))),
        ];
    }

    return $rows;
};

/**
 * The ULIDs in the order `sortItems` of the clickdummy gives them (empty values last, the direction for the value
 * alone, then rank and ULID byte by byte), with the collation of the database for texts (case and accents aside) and
 * numbers in texts and identifiers read as numbers (A450).
 */
$expected = function (array $rows, SortSpec $sort): array {
    $fold = fn (string $text) => mb_strtolower(Str::ascii($text));
    $read = function (array $row) use ($sort, $fold): array {
        $property = str_starts_with($sort->field, 'property:') ? substr($sort->field, 9) : null;
        $value = $property === null ? $row[$sort->field] : $row['values'][$property];
        $value = is_string($value) && in_array($property, ['customer_ref', 'ticket_url'], true) ? $fold($value) : $value;

        return [$value === null, is_array($value) ? $value : [$value]];
    };
    usort($rows, function (array $a, array $b) use ($read, $sort) {
        [$emptyA, $valuesA] = $read($a);
        [$emptyB, $valuesB] = $read($b);
        if ($emptyA !== $emptyB) {
            return $emptyA ? 1 : -1;
        }
        $result = 0;
        foreach ($emptyA ? [] : array_keys($valuesA) as $index) {
            $left = $valuesA[$index];
            $right = $valuesB[$index];
            $text = in_array($sort->field, ['key', 'property:customer_ref', 'property:ticket_url'], true);
            $result = $result !== 0 ? $result : (is_string($left) ? ($text ? strnatcmp($left, (string) $right) : strcmp($left, (string) $right)) <=> 0 : $left <=> $right);
        }

        return ($sort->descending ? -$result : $result) ?: strcmp($a['rank'], $b['rank']) ?: strcmp($a['id'], $b['id']);
    });

    return array_column($rows, 'id');
};

$sorts = [];
foreach ([...SortSpec::CORE, 'property:effort', 'property:release', 'property:customer_ref', 'property:ticket_url'] as $field) {
    foreach (['asc', 'desc'] as $direction) {
        $sorts["{$field}:{$direction}"] = [$field, $direction];
    }
}

it('pages every item exactly once', function (string $field, string $direction) use ($world, $expected, $forward, $backward, $sort) {
    $rows = $world($this->web);
    $order = $sort($field, $direction);
    $all = ItemOrder::apply(WorkItem::query(), $order)->get()->pluck('id')->all();

    // one query without pages is the order of `sortItems`
    expect($all)->toBe($expected($rows, $order))->toHaveCount(60);

    foreach ([1, 2, 3, 7] as $perPage) {
        $pages = $forward($order, $perPage);
        $ids = array_merge(...array_column($pages, 'ids'));

        // every page but the last is full, and together they are every item once, in the same order
        expect($ids)->toBe($all, "forward, {$perPage} per page")
            ->and(array_map('count', array_column(array_slice($pages, 0, -1), 'ids')))->each->toBe($perPage);

        // from the last page back, every previous page is the one that came before it
        $last = end($pages)['page'];
        $before = array_reverse(array_column(array_slice($pages, 0, -1), 'ids'));
        expect($backward($order, $last, $perPage))->toBe($before, "backward, {$perPage} per page");
    }
})->with($sorts);

it('pages backwards to the same items', function () use ($world, $sort) {
    $world($this->web);
    $order = $sort('due_date', 'desc');
    $first = ItemOrder::page(WorkItem::query(), $order, new PageArgs(null, 7));
    $second = ItemOrder::page(WorkItem::query(), $order, new PageArgs($first->nextCursor()?->encode(), 7));
    $third = ItemOrder::page(WorkItem::query(), $order, new PageArgs($second->nextCursor()?->encode(), 7));

    $back = ItemOrder::page(WorkItem::query(), $order, new PageArgs($third->previousCursor()?->encode(), 7));
    $front = ItemOrder::page(WorkItem::query(), $order, new PageArgs($back->previousCursor()?->encode(), 7));

    expect($back->pluck('id')->all())->toBe($second->pluck('id')->all())
        ->and($back->nextCursor()?->encode())->toBe($second->nextCursor()?->encode())
        ->and($front->pluck('id')->all())->toBe($first->pluck('id')->all())
        // the first page reached backwards has nothing before it
        ->and($front->previousCursor())->toBeNull()
        ->and($first->previousCursor())->toBeNull();
});

it('keeps equal ranks of different projects in a stable order', function () use ($sort) {
    $app = Project::factory()->identifier('APP')->create();
    $ops = Project::factory()->identifier('OPS')->create();
    $ids = collect([$this->web, $app, $ops])->map(fn (Project $project) => WorkItem::factory()->create(['project_id' => $project->id, 'rank' => 'a0'])->id)->sort()->values()->all();

    $pages = [];
    $cursor = null;
    foreach ([1, 2, 3] as $_) {
        $page = ItemOrder::page(WorkItem::query(), $sort('rank'), new PageArgs($cursor, 1));
        $pages[] = $page->pluck('id')->all()[0];
        $cursor = $page->nextCursor()?->encode();
    }

    expect(ItemOrder::apply(WorkItem::query(), $sort('rank'))->get()->pluck('id')->all())->toBe($ids)
        ->and($pages)->toBe($ids)
        ->and($cursor)->toBeNull();
});

it('sorts by key and category next to conditions on the columns their tables share', function () use ($sort) {
    $this->travelTo(Carbon::parse('2026-10-28 10:00', 'UTC'));
    Organization::current()->update(['timezone' => 'UTC']);
    $viewer = User::factory()->admin()->create();
    $app = Project::factory()->identifier('APP')->create(['created_at' => '2026-10-28 09:00:00']);
    $today = fn (Project $project, string $rank) => WorkItem::factory()->create(['project_id' => $project->id, 'rank' => $rank, 'created_at' => '2026-10-28 08:00:00']);
    $items = [$today($app, 'a0'), $today($app, 'a1'), $today($this->web, 'a0')];
    WorkItem::factory()->create(['project_id' => $app->id, 'created_at' => '2026-10-01 08:00:00']);
    WorkItem::factory()->archived()->create(['project_id' => $app->id, 'created_at' => '2026-10-28 08:00:00']);

    // projects and states have an id, a creation time and an archive stamp, too
    $filter = FilterSchema::parse(['version' => 1, 'conditions' => [
        ['field' => 'created_at', 'op' => 'is', 'value' => 'today'],
        ['field' => 'archived', 'op' => 'is', 'value' => false],
    ]], CatalogProperties::load());
    $query = fn () => FilterQuery::apply(WorkItem::query()->visibleTo($viewer), $filter, $viewer)->whereNull('work_items.archived_at');

    // by key APP before WEB; all in the backlog by rank, then ULID
    foreach (['key' => [0, 1, 2], 'state_category' => [0, 2, 1]] as $field => $order) {
        $first = ItemOrder::page($query(), $sort($field), new PageArgs(null, 2));
        $second = ItemOrder::page($query(), $sort($field), new PageArgs($first->nextCursor()?->encode(), 2));

        expect([...$first->pluck('id'), ...$second->pluck('id')])->toBe(array_map(fn (int $index) => $items[$index]->id, $order));
    }
});

it('pages numbers that differ beyond the precision of a float', function () use ($sort, $properties) {
    $effort = $properties()['effort'];
    ($this->catalog)();
    // the largest number first, so the ULIDs ascend against the numbers: a cursor compared as a float would end here
    $ids = [];
    foreach (['3', '2', '1'] as $last) {
        $item = WorkItem::factory()->create(['project_id' => $this->web->id, 'type_id' => ($this->type)('Task')->id, 'rank' => 'a0']);
        WorkItemValue::query()->create(['work_item_id' => $item->id, 'property_id' => $effort->id, 'position' => 0, 'value_number' => '12345678901234567.000'.$last]);
        $ids[] = $item->id;
    }

    $pages = [];
    $cursor = null;
    foreach ([1, 2, 3] as $_) {
        $page = ItemOrder::page(WorkItem::query(), $sort('property:effort'), new PageArgs($cursor, 1));
        $pages = [...$pages, ...$page->pluck('id')];
        $cursor = $page->nextCursor()?->encode();
    }

    expect($pages)->toBe(array_reverse($ids))->and($cursor)->toBeNull();
});

it('refuses a cursor of another sort', function () use ($sort, $refused) {
    WorkItem::factory()->count(3)->create(['project_id' => $this->web->id]);
    $cursor = ItemOrder::page(WorkItem::query(), $sort('due_date'), new PageArgs(null, 1))->nextCursor()?->encode();

    // the same keys in another direction, other keys
    $refused(fn () => ItemOrder::page(WorkItem::query(), $sort('due_date', 'desc'), new PageArgs($cursor, 1)));
    $refused(fn () => ItemOrder::page(WorkItem::query(), $sort('start_date'), new PageArgs($cursor, 1)));
    $refused(fn () => ItemOrder::page(WorkItem::query(), $sort('priority'), new PageArgs($cursor, 1)));
    expect(ItemOrder::page(WorkItem::query(), $sort('due_date'), new PageArgs($cursor, 1)))->toHaveCount(1);
});

it('refuses a cursor of another group', function () use ($sort, $refused) {
    WorkItem::factory()->count(3)->create(['project_id' => $this->web->id]);
    $cursor = ItemOrder::page(WorkItem::query(), $sort('rank'), new PageArgs(null, 1), 'priority:high')->nextCursor()?->encode();

    $refused(fn () => ItemOrder::page(WorkItem::query(), $sort('rank'), new PageArgs($cursor, 1), 'priority:low'));
    $refused(fn () => ItemOrder::page(WorkItem::query(), $sort('rank'), new PageArgs($cursor, 1)));
    expect(ItemOrder::page(WorkItem::query(), $sort('rank'), new PageArgs($cursor, 1), 'priority:high'))->toHaveCount(1);
});

it('refuses a cursor it cannot read', function () use ($sort, $refused, $tampered, $properties) {
    $properties();
    ($this->catalog)();
    WorkItem::factory()->count(3)->create(['project_id' => $this->web->id]);
    $page = fn (string $field, string $cursor) => ItemOrder::page(WorkItem::query(), $sort($field), new PageArgs($cursor, 2));

    $refused(fn () => $page('rank', 'abc'));
    // JSON, but no object of parameters
    $refused(fn () => $page('rank', base64_encode('"rank"')));

    $cases = [
        // a key missing, one too many, the direction of the cursor not a boolean
        ['rank', fn (array $p) => array_diff_key($p, ['id' => true])],
        ['rank', fn (array $p) => [...$p, 'title' => 'x']],
        ['rank', fn (array $p) => [...$p, '_pointsToNextItems' => 'yes']],
        // values that do not have the form the database gives them
        ['rank', fn (array $p) => [...$p, 'rank' => 5]],
        ['priority', fn (array $p) => [...$p, 'sort_0' => '1']],
        ['due_date', fn (array $p) => [...$p, 'sort_0' => 2]],
        ['due_date', fn (array $p) => [...$p, 'sort_1' => '2026-11-01 or 1']],
        ['created_at', fn (array $p) => [...$p, 'sort_0' => '2026-11-01']],
        ['updated_at', fn (array $p) => [...$p, 'sort_0' => '2026-11-01 10:00']],
        ['property:effort', fn (array $p) => [...$p, 'sort_1' => '1e3']],
    ];
    foreach ($cases as [$field, $change]) {
        $refused(fn () => $page($field, $tampered($sort($field), $change)));
    }

    // the cursor as it came is read; an empty one is the first page
    foreach (['rank', 'priority', 'due_date', 'created_at', 'updated_at', 'property:effort'] as $field) {
        expect($page($field, $tampered($sort($field), fn (array $p) => $p)))->toHaveCount(1);
    }
    expect($page('rank', ''))->toHaveCount(2);
});

it('refuses a cursor of another list', function () use ($sort, $refused) {
    $mara = User::factory()->create();
    foreach ([Project::factory()->identifier('APP')->public()->create(), Project::factory()->identifier('OPS')->public()->create()] as $project) {
        ToggleFavorite::run(actor($mara), ['kind' => 'project', 'id' => $project->id]);
    }
    WorkItem::factory()->count(3)->create(['project_id' => $this->web->id]);
    $favorites = ListFavorites::run(actor($mara), ['per_page' => 1])->page->nextCursor()?->encode();

    expect($favorites)->toBeString();
    $refused(fn () => ItemOrder::page(WorkItem::query(), $sort('rank'), new PageArgs($favorites, 1)));
});

it('asks the database twice for a page', function () use ($sort, $properties) {
    $properties();
    ($this->catalog)();
    $task = ($this->type)('Task')->id;
    foreach (range(1, 20) as $n) {
        $item = WorkItem::factory()->create(['project_id' => $this->web->id, 'type_id' => $task, 'rank' => 'a0']);
        ItemValues::store($item, ['effort' => $n % 4, 'release' => '2026-11-0'.($n % 9 + 1)], []);
    }

    foreach (['rank', 'key', 'state_category', 'property:effort', 'property:release'] as $field) {
        $cursor = null;
        foreach ([7, 100, 7] as $perPage) {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $query = WorkItem::query()->where('work_items.project_id', $this->web->id);
            $total = (clone $query)->toBase()->getCountForPagination();
            $result = new ListResult(ItemOrder::page($query, $sort($field), new PageArgs($cursor, $perPage)), $total);
            $result->page->nextCursor();
            $result->page->previousCursor();
            DB::disableQueryLog();

            // the rows of the page and the number of all matches, whatever the size of the page or the cursor
            expect(DB::getQueryLog())->toHaveCount(2, "{$field}, {$perPage} per page")
                ->and($result->total)->toBe(20);
            $cursor = $perPage === 7 ? $result->page->nextCursor()?->encode() : null;
        }
    }
});

it('hands out rows whose sort keys are original attributes, so a save of a page row writes only what changed', function () use ($sort) {
    WorkItem::factory()->create(['project_id' => $this->web->id, 'title' => 'a', 'due_date' => '2026-10-01']);

    $row = ItemOrder::page(WorkItem::query(), $sort('due_date'), new PageArgs(null, 5))->items()[0];
    expect(array_key_exists('sort_0', $row->getAttributes()))->toBeTrue()
        ->and(array_key_exists('_sig', $row->getAttributes()))->toBeTrue()
        ->and($row->isDirty())->toBeFalse();

    $row->title = 'b';

    expect($row->getDirty())->toBe(['title' => 'b']);
});
