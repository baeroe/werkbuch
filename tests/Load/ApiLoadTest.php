<?php

use App\Domain\Views\GroupBy;
use App\Domain\Views\SortSpec;
use App\Models\User;
use Database\Seeders\Load\LoadItems;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Load\LoadTestCase;
use Tests\Load\LoadWorld;
use Tests\Load\Support\Budget;

/*
 * The API against 50 000 items (plan, Task 8b; A187, K10). Every row is measured in the database `load`: a warm-up
 * run, then three runs, each after forgetScopedInstances() and Visibility::forget(); the median has to stay within
 * 1.5 s. The hard check is the number of queries: it is the same as in a small world, the same requests in a
 * transaction (rolled back) in which every project keeps only its first 100 items (2 000 in all) and the wiki of L01
 * only its 20 top pages. The same projects, the same people and the same subjects: the epic L07-1 keeps its 40 children
 * and its relations (LoadItems puts them among the first 100), L07-2 its 40 comments and its history. A query count
 * hangs on what an answer holds (an item with a parent loads the parents, a text with a reference reads the referenced
 * items), so a small world of other subjects would compare unlike answers.
 *
 * The small world holds answers as big as the big one where the answer is a page (100 items, 40 comments, 100 events,
 * 20 projects) or the subject itself (the children and relations of L07-1): a query per item, comment or event would
 * count the same in both. Those rows have a second check, a smaller answer in the big world (`smaller`: a page of 25, the
 * epic with 10 of its children in a transaction rolled back), which has to ask as often as the row; a query per entry of
 * the answer shows there. The groups and the counts have none: their groups and filters are the same in both worlds
 * (only `groups parent` grows, 2 500 epics against 100), and the counts ask once per filter by design. The search is
 * compared with a search of more hits (`baseline`), the pages of L01 with 20 top pages against 2 000.
 *
 * The table of every row (median, runs, queries) goes to STDERR at the end and to storage/logs/load-budget.md (the
 * artifact `load-budget` of the CI job `load`).
 */

/**
 * The rows over the budget of 1.5 s, by the task that takes them out (K10, K13): they run and are measured like every
 * other row, only their median is not asserted. Their query count is. In DDEV every row stays within the budget; the
 * CI job `load` (PR #32, run 42439150185, MariaDB with the image's buffer pool of 128 MiB) measured these over it.
 * Task 10a took out the sort by a property (CI 1 764 and 1 784 ms): its first value is joined once and read from an
 * index. Task 10b took out the board of a project (CI 2 193 ms, seven answers measured together): each page read its
 * labels with a join MariaDB could begin with the labels, now it reads them from `work_item_labels` alone.
 */
const OVER_BUDGET = [];

/** The first page of every list, as the browser asks it. */
const LOAD_PAGE = 100;

/**
 * The page of the smaller answer: a query per entry of a page counts 75 more against LOAD_PAGE. Not 10: in the sort by
 * rank or creation the first 20 items are the first epics of the 20 projects, a page of 10 holds no item with a parent
 * and loads no parents (12 queries instead of 14, an answer of another form).
 */
const SMALLER_PAGE = 25;

/**
 * What the rows ask: the reader (load-01, the org admin), a member (load-05: some projects, private ones among them,
 * and the public ones), the project L07 of the rows that name one, its epic with 40 children, its item with 40
 * comments, the wiki of L01 and the label the counts name.
 *
 * @return array{admin: User, member: User, project: string, identifier: string, epic: string, busy: string, pages: string, label: string}
 */
$world = function (): array {
    $identifier = 'L07';
    $project = (string) DB::table('projects')->where('identifier', $identifier)->value('id');

    return [
        'admin' => User::query()->where('handle', 'load-01')->sole(),
        'member' => User::query()->where('handle', 'load-05')->sole(),
        'project' => $project,
        'identifier' => $identifier,
        'epic' => "{$identifier}-1",
        'busy' => "{$identifier}-2",
        'pages' => 'L01',
        'label' => (string) DB::table('labels')->orderBy('id')->value('id'),
    ];
};

$condition = fn (string $field, string $op, mixed $value = null): array => array_filter(['field' => $field, 'op' => $op, 'value' => $value], fn ($part) => $part !== null);
$filter = fn (array ...$conditions): array => ['version' => 1, 'conditions' => $conditions];

/**
 * The rows: name => the request (the test case and the world), what its answer has to hold in the big world (so no
 * row measures an empty answer), for the one row the small world cannot answer the baseline asked otherwise (with what
 * its answer has to hold), and for the rows whose answer is as big in both worlds a smaller answer in the big world
 * (`shrink` changes the data in a transaction that is rolled back).
 *
 * @var array<string, array{request: Closure(LoadTestCase, array<string, mixed>): TestResponse, check: Closure(TestResponse): void, baseline?: array{reason: string, request: Closure(LoadTestCase, array<string, mixed>): TestResponse, check: Closure(TestResponse): void}, smaller?: array{request: Closure(LoadTestCase, array<string, mixed>): TestResponse, check: Closure(TestResponse): void, shrink?: Closure(array<string, mixed>): void}}>
 */
$rows = [];

$fullPage = function (TestResponse $answer): void {
    $answer->assertOk();
    expect($answer->json('data'))->toHaveCount(LOAD_PAGE)
        ->and($answer->json('meta.total'))->toBeGreaterThan(LOAD_PAGE);
};
$smallPage = function (TestResponse $answer): void {
    $answer->assertOk();
    expect($answer->json('data'))->toHaveCount(SMALLER_PAGE)
        ->and($answer->json('meta.total'))->toBeGreaterThan(LOAD_PAGE);
};

foreach ([...SortSpec::CORE, 'property:effort'] as $field) {
    foreach (['asc', 'desc'] as $direction) {
        $query = fn (int $page) => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->postJson('/api/v1/work-items/query', [
            'sort' => ['field' => $field, 'direction' => $direction], 'lean' => true, 'per_page' => $page,
        ]);
        $rows["query {$field} {$direction}"] = [
            'request' => $query(LOAD_PAGE),
            'check' => $fullPage,
            'smaller' => ['request' => $query(SMALLER_PAGE), 'check' => $smallPage],
        ];
    }
}

$list = fn (int $page) => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/work-items?filter[project]={$w['identifier']}&per_page={$page}");
$rows['list of a project'] = [
    'request' => $list(LOAD_PAGE),
    'check' => $fullPage,
    'smaller' => ['request' => $list(SMALLER_PAGE), 'check' => $smallPage],
];

$groups = function (TestResponse $answer): void {
    $answer->assertOk();
    expect($answer->json('data.groups'))->not->toBeEmpty()
        ->and($answer->json('data.total'))->toBeGreaterThan(LOAD_PAGE);
};
foreach (GroupBy::cases() as $by) {
    $rows["groups {$by->value}"] = [
        'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->postJson('/api/v1/work-items/groups', ['group_by' => $by->value]),
        'check' => $groups,
    ];
    $rows["groups {$by->value} of a project"] = [
        'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->postJson('/api/v1/work-items/groups', [
            'group_by' => $by->value, 'filter' => $filter($condition('project', 'is', $w['project'])),
        ]),
        'check' => $groups,
    ];
}

$rows['counts of 10 filters'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->postJson('/api/v1/work-items/counts', ['filters' => [
        'backlog' => $filter($condition('state_category', 'is', 'backlog')),
        'unstarted' => $filter($condition('state_category', 'is', 'unstarted')),
        'started' => $filter($condition('state_category', 'is', 'started')),
        'completed' => $filter($condition('state_category', 'is', 'completed')),
        'canceled' => $filter($condition('state_category', 'is', 'canceled')),
        'urgent' => $filter($condition('priority', 'is', 'urgent')),
        'mine' => $filter($condition('assignee', 'is', 'me')),
        'unassigned' => $filter($condition('assignee', 'is_empty')),
        'overdue' => $filter($condition('due_date', 'overdue')),
        'label' => $filter($condition('label', 'is', $w['label'])),
    ]]),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('data'))->toHaveCount(10)
            ->and($answer->json('data.started'))->toBeGreaterThan(LOAD_PAGE);
    },
];

// the board of a project grouped by state: its groups, then the first page of every group (the browser enables each)
$board = fn (int $page) => function (LoadTestCase $t, array $w) use ($filter, $condition, $page): TestResponse {
    $scope = $filter($condition('project', 'is', $w['project']));
    $groups = $t->actingAs($w['admin'])->postJson('/api/v1/work-items/groups', ['group_by' => 'state', 'filter' => $scope])->assertOk();
    $pages = [];
    foreach ($groups->json('data.groups') as $group) {
        $pages[] = $t->postJson('/api/v1/work-items/query', [
            'filter' => $scope, 'group_by' => $groups->json('data.group_by'), 'group' => $group['key'], 'lean' => true, 'per_page' => $page,
        ])->assertOk()->json('data');
    }

    return TestResponse::fromBaseResponse(response()->json(['groups' => $groups->json('data.groups'), 'pages' => $pages]));
};
$boardOf = fn (int $page) => function (TestResponse $answer) use ($page): void {
    $sizes = array_map(fn (array $items) => count($items), $answer->json('pages'));
    expect($answer->json('groups'))->toHaveCount(6)
        ->and($sizes)->toContain($page)
        ->and(max($sizes))->toBe($page);
};
$rows['board of a project'] = [
    'request' => $board(LOAD_PAGE),
    'check' => $boardOf(LOAD_PAGE),
    'smaller' => ['request' => $board(SMALLER_PAGE), 'check' => $boardOf(SMALLER_PAGE)],
];

$rows['item with children, relations, type, workflow, attachments'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/work-items/{$w['epic']}?include=children,relations,type,workflow,attachments"),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('data.children'))->toHaveCount(40)
            ->and(count($answer->json('data.relations')))->toBeGreaterThanOrEqual(count(LoadItems::EPIC_RELATIONS))
            ->and($answer->json('data.attachments'))->toHaveCount(3);
    },
    // the same epic with 10 of its children (2–11), without its relations to 8, 9 and 10 (every relation type, the
    // hidden ends and the other projects stay) and without one of its files (the PNG with its preview stays)
    'smaller' => [
        'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/work-items/{$w['epic']}?include=children,relations,type,workflow,attachments"),
        'check' => function (TestResponse $answer): void {
            $answer->assertOk();
            expect($answer->json('data.children'))->toHaveCount(10)
                ->and(count($answer->json('data.relations')))->toBeGreaterThanOrEqual(count(LoadItems::EPIC_RELATIONS) - 3)
                ->and($answer->json('data.attachments'))->toHaveCount(2);
        },
        'shrink' => function (array $w): void {
            $epic = (string) DB::table('work_items')->where('project_id', $w['project'])->where('number', 1)->value('id');
            DB::table('work_items')->where('parent_id', $epic)->where('number', '>', 11)->update(['parent_id' => null]);
            $ends = DB::table('work_items')->where('project_id', $w['project'])->whereIn('number', [8, 9, 10])->pluck('id')->all();
            expect(DB::table('work_item_relations')
                ->where(fn ($query) => $query->where('source_id', $epic)->whereIn('target_id', $ends))
                ->orWhere(fn ($query) => $query->where('target_id', $epic)->whereIn('source_id', $ends))
                ->delete())->toBe(3);
            expect(DB::table('attachments')->where('attachable_id', $epic)->where('filename', 'notizen.txt')->delete())->toBe(1);
        },
    ],
];

$rows['comments of an item'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/work-items/{$w['busy']}/comments"),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('data'))->toHaveCount(40);
    },
    'smaller' => [
        'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/work-items/{$w['busy']}/comments?per_page=".SMALLER_PAGE),
        'check' => function (TestResponse $answer): void {
            $answer->assertOk();
            expect($answer->json('data'))->toHaveCount(SMALLER_PAGE)
                ->and($answer->json('meta.total'))->toBe(40);
        },
    ],
];

$history = fn (int $page) => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/work-items/{$w['busy']}/history?per_page={$page}");
$rows['history of an item'] = [
    'request' => $history(LOAD_PAGE),
    'check' => $fullPage,
    'smaller' => ['request' => $history(SMALLER_PAGE), 'check' => $smallPage],
];

$rows['search'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson('/api/v1/search?q=Formular'),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('data.items'))->toHaveCount(20)
            ->and($answer->json('data.pages'))->not->toBeEmpty();
    },
    // the small world shares the search index of the big one: its hits are items the transaction deleted, and a search
    // without a hit reads nothing (QuerySearch skips the empty lists). The baseline is the same search with the most
    // hits a search gives (50 per kind instead of 20): the same queries for more hits.
    'baseline' => [
        'reason' => 'the index is not part of the transaction',
        'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson('/api/v1/search?q=Formular&limit=50'),
        'check' => function (TestResponse $answer): void {
            $answer->assertOk();
            // more hits than the row, or a query per hit would count the same in both
            expect(count($answer->json('data.items')))->toBeGreaterThan(20);
        },
    ],
];

$projects = fn (string $who, ?int $page = null) => fn (LoadTestCase $t, array $w) => $t->actingAs($w[$who])->getJson('/api/v1/projects'.($page === null ? '' : "?per_page={$page}"));
$rows['projects'] = [
    'request' => $projects('admin'),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('data'))->toHaveCount(20)
            ->and($answer->json('meta.total'))->toBe(20);
    },
    'smaller' => [
        'request' => $projects('admin', 5),
        'check' => function (TestResponse $answer): void {
            $answer->assertOk();
            expect($answer->json('data'))->toHaveCount(5);
        },
    ],
];

$rows['pages of a project'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/projects/{$w['pages']}/pages"),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('meta.total'))->toBe(2_000);
    },
];

// a member sees the projects they belong to and the public ones (Visibility::projectIds), never every project
$memberQuery = fn (int $page) => fn (LoadTestCase $t, array $w) => $t->actingAs($w['member'])->postJson('/api/v1/work-items/query', ['lean' => true, 'per_page' => $page]);
$rows['query rank asc as a member'] = [
    'request' => $memberQuery(LOAD_PAGE),
    'check' => $fullPage,
    'smaller' => ['request' => $memberQuery(SMALLER_PAGE), 'check' => $smallPage],
];
$rows['groups project as a member'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['member'])->postJson('/api/v1/work-items/groups', ['group_by' => 'project']),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        // load-05 belongs to some private projects, never to all five
        expect(count($answer->json('data.groups')))->toBeGreaterThan(1)->toBeLessThan(20);
    },
];
$rows['projects as a member'] = [
    'request' => $projects('member'),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('meta.total'))->toBeGreaterThan(2)->toBeLessThan(20)
            ->and($answer->json('data'))->toHaveCount($answer->json('meta.total'));
    },
    'smaller' => [
        'request' => $projects('member', 2),
        'check' => function (TestResponse $answer): void {
            $answer->assertOk();
            expect($answer->json('data'))->toHaveCount(2);
        },
    ],
];

/**
 * The queries of every row in the small world (once per process): in a transaction that is rolled back, the items
 * after number 100 of every project and the pages below the top level of L01 are deleted. A row with its own baseline
 * is asked in the big world instead.
 *
 * @return array<string, int>
 */
$baselines = function (LoadTestCase $test) use ($rows, $world): array {
    if (($known = Budget::baselines()) !== null) {
        return $known;
    }

    $big = $world();
    $counts = [];
    foreach ($rows as $name => $row) {
        if (isset($row['baseline'])) {
            $counts[$name] = Budget::queries(fn () => $row['baseline']['request']($test, $big));
            ($row['baseline']['check'])(Budget::answer());
        }
    }

    DB::beginTransaction();
    try {
        $started = microtime(true);
        // LoadItems gives the first 100 items of a project only parents among them; the rows the delete takes name no
        // parent (a self-referencing set null inside one delete is refused)
        DB::table('work_items')->where('number', '>', LOAD_PAGE)->whereNotNull('parent_id')->update(['parent_id' => null]);
        DB::table('work_items')->where('number', '>', LOAD_PAGE)->delete();
        // the wiki of L01 down to its top level (the versions go with their pages)
        $l01 = DB::table('projects')->where('identifier', 'L01')->value('id');
        $deeper = DB::table('pages')->where('project_id', $l01)->whereNotNull('parent_id')->pluck('id')->all();
        DB::table('pages')->whereIn('id', $deeper)->update(['parent_id' => null]);
        DB::table('pages')->whereIn('id', $deeper)->delete();

        expect(DB::table('work_items')->count())->toBe(20 * LOAD_PAGE)
            ->and(DB::table('work_items')->whereNotNull('parent_id')->count())->toBeGreaterThan(20 * 40)
            ->and(DB::table('pages')->count())->toBe(20);
        fwrite(STDERR, sprintf("\nThe small world took %.1f s.\n", microtime(true) - $started));

        foreach ($rows as $name => $row) {
            if (! isset($row['baseline'])) {
                $counts[$name] = Budget::queries(fn () => $row['request']($test, $big)->assertOk());
            }
        }
    } finally {
        DB::rollBack();
    }

    Budget::rememberBaselines($counts);

    return $counts;
};

/**
 * The queries of the smaller answer of a row, in the big world (`shrink` in a transaction that is rolled back), after
 * checking that answer; null for a row without one.
 */
$smaller = function (LoadTestCase $test, array $row, array $big): ?int {
    if (! isset($row['smaller'])) {
        return null;
    }

    DB::beginTransaction();
    try {
        if (isset($row['smaller']['shrink'])) {
            ($row['smaller']['shrink'])($big);
        }
        $queries = Budget::queries(fn () => $row['smaller']['request']($test, $big));
        ($row['smaller']['check'])(Budget::answer());
    } finally {
        DB::rollBack();
    }

    return $queries;
};

it('answers within budget', function (string $name) use ($rows, $world, $baselines, $smaller) {
    LoadWorld::ensure();
    $baseline = $baselines($this)[$name];
    $big = $world();
    $row = $rows[$name];
    $small = $smaller($this, $row, $big);

    $median = Budget::measure($name, fn () => $row['request']($this, $big), baseline: $baseline, smaller: $small);
    ($row['check'])(Budget::answer());

    // the hard check: the same queries as against 100 items (K10), in every run
    expect(Budget::row($name)['queries'])->toBe([$baseline, $baseline, $baseline], "{$name} asks the database otherwise than against 100 items");
    // and as for a smaller answer: no query per item, comment, event, child or relation of the answer
    if ($small !== null) {
        expect($small)->toBe($baseline, "{$name} asks the database otherwise for a smaller answer");
    }
    if (! array_key_exists($name, OVER_BUDGET)) {
        expect($median)->toBeLessThanOrEqual(Budget::SECONDS, sprintf('%s took %.0f ms (median)', $name, $median * 1_000));
    }
})->with(array_keys($rows));

it('names only rows that exist', function () use ($rows) {
    // mutation probes (report of Task 8b, fix round) show that it fails on a name that is no row and on a reason without
    // a task, and passes on the rows OVER_BUDGET names (the loop is empty whenever OVER_BUDGET is)
    foreach (OVER_BUDGET as $name => $reason) {
        // the second argument of toHaveKey is the value the key must hold, the message is named
        expect($rows)->toHaveKey($name, message: "OVER_BUDGET names {$name}, which is no row");
        expect($reason)->toMatch('/^Task \d+[a-z]?: \S/', "the reason of {$name} names no task");
    }

    expect(count($rows))->toBeGreaterThan(40);
});

it('checks a smaller answer wherever the small world answers as much', function () use ($rows) {
    // every other row has a smaller answer (a page of 25, fewer children); these answer differently in the two worlds
    // (the pages, `groups parent`), ask once per filter by design (the counts) or hold the same groups in both
    $without = array_keys(array_filter($rows, fn (array $row) => ! isset($row['smaller'])));
    $groups = array_map(fn (GroupBy $by) => "groups {$by->value}", GroupBy::cases());

    expect($without)->toEqualCanonicalizing([
        ...$groups,
        ...array_map(fn (string $name) => "{$name} of a project", $groups),
        'groups project as a member',
        'counts of 10 filters',
        'search',
        'pages of a project',
    ]);
});

it('measures with the rate limits of the CI', function () {
    // DDEV sets 6000 and 60000 in the environment of the container; phpunit.load.xml forces the values of the CI
    expect(config('werkbuch.rate_limits.api'))->toBe(600)
        ->and(config('werkbuch.rate_limits.api_session'))->toBe(3000)
        ->and(config('werkbuch.rate_limits.mcp'))->toBe(300);
});

afterAll(function () {
    Budget::write(OVER_BUDGET);
    fwrite(STDERR, "\n".Budget::table(OVER_BUDGET)."\n");
});
