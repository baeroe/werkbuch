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
 * The table of every row (median, runs, queries) goes to STDERR at the end and to storage/logs/load-budget.md (the
 * artifact `load-budget` of the CI job `load`).
 */

/**
 * The rows over the budget of 1.5 s, by the task that takes them out (K10, K13): they run and are measured like every
 * other row, only their median is not asserted. Their query count is.
 */
const OVER_BUDGET = [];

/** The first page of every list, as the browser asks it. */
const LOAD_PAGE = 100;

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
 * row measures an empty answer), and, for the one row the small world cannot answer, the baseline asked otherwise.
 *
 * @var array<string, array{request: Closure(LoadTestCase, array<string, mixed>): TestResponse, check: Closure(TestResponse): void, baseline?: array{reason: string, request: Closure(LoadTestCase, array<string, mixed>): TestResponse}}>
 */
$rows = [];

$fullPage = function (TestResponse $answer): void {
    $answer->assertOk();
    expect($answer->json('data'))->toHaveCount(LOAD_PAGE)
        ->and($answer->json('meta.total'))->toBeGreaterThan(LOAD_PAGE);
};

foreach ([...SortSpec::CORE, 'property:effort'] as $field) {
    foreach (['asc', 'desc'] as $direction) {
        $rows["query {$field} {$direction}"] = [
            'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->postJson('/api/v1/work-items/query', [
                'sort' => ['field' => $field, 'direction' => $direction], 'lean' => true, 'per_page' => LOAD_PAGE,
            ]),
            'check' => $fullPage,
        ];
    }
}

$rows['list of a project'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/work-items?filter[project]={$w['identifier']}"),
    'check' => $fullPage,
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
$rows['board of a project'] = [
    'request' => function (LoadTestCase $t, array $w) use ($filter, $condition): TestResponse {
        $scope = $filter($condition('project', 'is', $w['project']));
        $groups = $t->actingAs($w['admin'])->postJson('/api/v1/work-items/groups', ['group_by' => 'state', 'filter' => $scope])->assertOk();
        $pages = [];
        foreach ($groups->json('data.groups') as $group) {
            $pages[] = $t->postJson('/api/v1/work-items/query', [
                'filter' => $scope, 'group_by' => $groups->json('data.group_by'), 'group' => $group['key'], 'lean' => true, 'per_page' => LOAD_PAGE,
            ])->assertOk()->json('data');
        }

        return TestResponse::fromBaseResponse(response()->json(['groups' => $groups->json('data.groups'), 'pages' => $pages]));
    },
    'check' => function (TestResponse $answer): void {
        expect($answer->json('groups'))->toHaveCount(6)
            ->and(array_map(fn (array $page) => count($page), $answer->json('pages')))->toContain(LOAD_PAGE);
    },
];

$rows['item with children, relations, type, workflow, attachments'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/work-items/{$w['epic']}?include=children,relations,type,workflow,attachments"),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('data.children'))->toHaveCount(40)
            ->and(count($answer->json('data.relations')))->toBeGreaterThanOrEqual(count(LoadItems::EPIC_RELATIONS))
            ->and($answer->json('data.attachments'))->toHaveCount(3);
    },
];

$rows['comments of an item'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/work-items/{$w['busy']}/comments"),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('data'))->toHaveCount(40);
    },
];

$rows['history of an item'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/work-items/{$w['busy']}/history"),
    'check' => $fullPage,
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
    ],
];

$rows['projects'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson('/api/v1/projects'),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('meta.total'))->toBe(20);
    },
];

$rows['pages of a project'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['admin'])->getJson("/api/v1/projects/{$w['pages']}/pages"),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('meta.total'))->toBe(2_000);
    },
];

// a member sees the projects they belong to and the public ones (Visibility::projectIds), never every project
$rows['query rank asc as a member'] = [
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['member'])->postJson('/api/v1/work-items/query', ['lean' => true, 'per_page' => LOAD_PAGE]),
    'check' => $fullPage,
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
    'request' => fn (LoadTestCase $t, array $w) => $t->actingAs($w['member'])->getJson('/api/v1/projects'),
    'check' => function (TestResponse $answer): void {
        $answer->assertOk();
        expect($answer->json('meta.total'))->toBeGreaterThan(1)->toBeLessThan(20);
    },
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

it('answers within budget', function (string $name) use ($rows, $world, $baselines) {
    LoadWorld::ensure();
    $baseline = $baselines($this)[$name];
    $big = $world();
    $row = $rows[$name];

    $median = Budget::measure($name, fn () => $row['request']($this, $big), baseline: $baseline);
    ($row['check'])(Budget::answer());

    // the hard check: the same queries as against 100 items (K10), in every run
    expect(Budget::row($name)['queries'])->toBe([$baseline, $baseline, $baseline], "{$name} asks the database otherwise than against 100 items");
    if (! array_key_exists($name, OVER_BUDGET)) {
        expect($median)->toBeLessThanOrEqual(Budget::SECONDS, sprintf('%s took %.0f ms (median)', $name, $median * 1_000));
    }
})->with(array_keys($rows));

it('names only rows that exist', function () use ($rows) {
    foreach (OVER_BUDGET as $name => $reason) {
        expect($rows)->toHaveKey($name, "OVER_BUDGET names {$name}, which is no row");
        expect($reason)->toMatch('/^Task \d+[a-z]?: \S/', "the reason of {$name} names no task");
    }

    expect(count($rows))->toBeGreaterThan(40);
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
