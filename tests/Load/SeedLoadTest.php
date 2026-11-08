<?php

use App\Access\Visibility;
use App\Models\User;
use Database\Seeders\Load\LoadHistory;
use Database\Seeders\Load\LoadItems;
use Database\Seeders\LoadSeeder;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Load\LoadWorld;

// every statement of every connection while the closure runs (the guard has to stop before the first one)
$statementsOf = function (Closure $run): array {
    $statements = [];
    DB::listen(function (QueryExecuted $query) use (&$statements): void {
        $statements[] = $query->sql;
    });

    $run();

    return $statements;
};

it('refuses a database other than load', function () use ($statementsOf) {
    LoadWorld::forget();
    // a name no database has: should the guard ever break, the test fails on the connection, never on a database of use
    config(['database.connections.mariadb.database' => 'load_refused']);
    DB::purge('mariadb');

    try {
        $refused = null;
        $statements = $statementsOf(function () use (&$refused): void {
            try {
                LoadWorld::ensure();
            } catch (RuntimeException $e) {
                $refused = $e;
            }
        });
    } finally {
        config(['database.connections.mariadb.database' => 'load']);
        DB::purge('mariadb');
    }

    expect($refused)->toBeInstanceOf(RuntimeException::class)
        ->and($refused?->getMessage())->toContain('load_refused')
        ->and($statements)->toBe([]);
});

it('stops every load test before its first statement on another database (T8a-M6)', function () use ($statementsOf) {
    config(['database.connections.mariadb.database' => 'load_refused']);
    DB::purge('mariadb');

    try {
        $refused = null;
        // the set-up of a test runs its traits: the guard stands before them
        $statements = $statementsOf(function () use (&$refused): void {
            try {
                $this->setUpTraits();
            } catch (RuntimeException $e) {
                $refused = $e;
            }
        });
    } finally {
        config(['database.connections.mariadb.database' => 'load']);
        DB::purge('mariadb');
    }

    expect($refused)->toBeInstanceOf(RuntimeException::class)
        ->and($refused?->getMessage())->toContain('load_refused')
        ->and($statements)->toBe([]);
});

it('refuses a search prefix other than load_', function () use ($statementsOf) {
    LoadWorld::forget();
    config(['scout.prefix' => 'testing_']);

    try {
        $refused = null;
        $statements = $statementsOf(function () use (&$refused): void {
            try {
                LoadWorld::ensure();
            } catch (RuntimeException $e) {
                $refused = $e;
            }
        });
    } finally {
        config(['scout.prefix' => 'load_']);
    }

    expect($refused)->toBeInstanceOf(RuntimeException::class)
        ->and($refused?->getMessage())->toContain('testing_')
        ->and($statements)->toBe([]);
});

it('seeds 50 000 items in 20 projects', function () {
    LoadWorld::ensure();

    $projects = DB::table('projects')->orderBy('identifier')->pluck('id', 'identifier');
    $l01 = $projects['L01'];

    expect(DB::getDatabaseName())->toBe('load')
        ->and($projects->keys()->all())->toBe(array_map(fn (int $n) => sprintf('L%02d', $n), range(1, 20)))
        ->and(DB::table('work_items')->count())->toBe(50_000)
        ->and(DB::table('work_items')->where('project_id', $projects['L07'])->count())->toBe(2_500)
        ->and(DB::table('work_item_relations')->count())->toBe(5_000)
        ->and(DB::table('comments')->count())->toBe(100_000)
        ->and(DB::table('comments')->selectRaw('count(*) as n')->groupBy('work_item_id')->orderByDesc('n')->value('n'))->toBe(40)
        ->and(DB::table('pages')->where('project_id', $l01)->count())->toBe(2_000)
        ->and(DB::table('pages')->where('project_id', '!=', $l01)->count())->toBe(0)
        // every page whose text references an item names it in page_item_references (one item per text, A456)
        ->and(DB::table('page_item_references')->count())->toBe(DB::table('pages')->where('content', 'like', '%"reference"%')->count())
        ->and(DB::table('page_item_references')->count())->toBeGreaterThan(1_000)
        ->and(DB::table('templates')->count())->toBe(200)
        ->and(DB::table('templates')->whereNotNull('schedule')->count())->toBe(50)
        ->and(DB::table('templates')->whereNotNull('schedule')->distinct()->count('next_run_at'))->toBe(1)
        ->and(DB::table('webhooks')->count())->toBe(50)
        ->and(DB::table('webhooks')->where('active', true)->count())->toBe(0)
        ->and(DB::table('users')->where('email', 'like', 'load-%@example.com')->count())->toBe(30)
        ->and(DB::table('users')->where('type', 'bot')->where('is_default_bot', false)->count())->toBe(5)
        ->and(DB::table('load_meta')->where('name', 'version')->value('value'))->toBe((string) LoadSeeder::VERSION)
        ->and(DB::table('load_meta')->where('name', 'work_items')->value('value'))->toBe('50000');

    // the numbers the random draws of the seeder decide (LoadRandom, Faker with seed 15): a later rand() or
    // random_int() changes them; a changed seeder raises LoadSeeder::VERSION and these numbers with it (T8a-M3)
    expect([
        'work_item_labels' => DB::table('work_item_labels')->count(),
        'work_item_values' => DB::table('work_item_values')->count(),
        'page_versions' => DB::table('page_versions')->count(),
        'page_item_references' => DB::table('page_item_references')->count(),
        'events' => DB::table('events')->count(),
        'assigned' => DB::table('work_items')->whereNotNull('assignee_id')->count(),
        'children' => DB::table('work_items')->whereNotNull('parent_id')->count(),
    ])->toBe([
        'work_item_labels' => 75_170,
        'work_item_values' => 129_807,
        'page_versions' => 4_929,
        'page_item_references' => 1_378,
        'events' => 266_082,
        'assigned' => 35_016,
        'children' => 24_309,
    ]);

    // every org role in the team of the one organization, the default bot its admin: it sees all 20 projects, the
    // private ones too (the night and every template run act as it)
    $organization = (string) DB::table('organization')->value('id');
    $bot = User::defaultBot();
    expect(DB::table('model_has_roles')->join('roles', 'roles.id', '=', 'model_has_roles.role_id')
        ->where('roles.name', 'like', 'org-%')->distinct()->pluck('model_has_roles.team_id')->all())->toBe([$organization])
        ->and(DB::table('model_has_roles')->join('roles', 'roles.id', '=', 'model_has_roles.role_id')
            ->where('model_has_roles.model_id', $bot->id)->where('model_has_roles.team_id', $organization)->pluck('roles.name')->all())->toBe(['org-admin'])
        ->and(DB::table('projects')->where('visibility', 'private')->count())->toBe(5)
        ->and(Visibility::projectIds($bot))->toHaveCount(20);

    // one epic per project with 40 children, the deepest page on level 4, archived items only closed ones
    $epic = DB::table('work_items')->where('project_id', $l01)->whereNotNull('parent_id')
        ->selectRaw('parent_id, count(*) as n')->groupBy('parent_id')->orderByDesc('n')->first();
    $depth = function (string $id) {
        $level = 1;
        while (($id = DB::table('pages')->where('id', $id)->value('parent_id')) !== null) {
            $level++;
        }

        return $level;
    };
    $deepest = DB::table('pages as p')->join('pages as q', 'q.id', '=', 'p.parent_id')->join('pages as r', 'r.id', '=', 'q.parent_id')
        ->whereNotNull('r.parent_id')->value('p.id');
    // and none deeper: no page on level 4 has a child (T8a-M7)
    $deeper = DB::table('pages as p')->join('pages as q', 'q.id', '=', 'p.parent_id')->join('pages as r', 'r.id', '=', 'q.parent_id')
        ->join('pages as s', 's.id', '=', 'r.parent_id')->whereNotNull('s.parent_id')->count();

    // the first epic of every project: its children the 40 items after it (so they stay among the first 100), its 11
    // relations and its three files; the history of every item, the busiest one over two pages of 100
    $first = DB::table('work_items')->where('project_id', $projects['L07'])->where('number', 1)->value('id');
    $busy = DB::table('work_items')->where('project_id', $projects['L07'])->where('number', LoadItems::BUSY)->value('id');
    $relations = DB::table('work_item_relations')->where('source_id', $first)->orWhere('target_id', $first)->count();
    expect(DB::table('work_items')->where('parent_id', $first)->orderBy('number')->pluck('number')->all())->toBe([...range(2, 20), ...range(22, 40), 42, 43])
        ->and($relations)->toBeGreaterThanOrEqual(count(LoadItems::EPIC_RELATIONS))
        ->and(DB::table('attachments')->where('attachable_id', $first)->where('kind', 'file')->pluck('filename')->sort()->values()->all())->toBe(['entwurf.png', 'konzept.pdf', 'notizen.txt'])
        ->and(DB::table('media')->whereIn('model_id', DB::table('attachments')->where('attachable_id', $first)->select('id'))->count())->toBe(3)
        ->and(DB::table('events')->where('type', 'work_item.created')->count())->toBe(50_000)
        ->and(DB::table('events')->where('type', 'work_item.relation_added')->count())->toBe(10_000)
        ->and(DB::table('events')->where('subject_id', $busy)->count())->toBeGreaterThan(LoadHistory::HEAVY)
        ->and(DB::table('events')->where('subject_id', $first)->where('type', 'work_item.relation_added')->count())->toBe($relations)
        ->and(DB::table('events')->count())->toBeGreaterThan(200_000)
        ->and(DB::table('events')->whereNull('dispatched_at')->count())->toBe(0);

    expect($epic?->n)->toBe(40)
        ->and($depth((string) $deepest))->toBe(4)
        ->and($deeper)->toBe(0)
        ->and(DB::table('work_items')->whereNotNull('archived_at')->count())->toBe(5_000)
        ->and(DB::table('work_items')->whereNotNull('archived_at')->whereNull('closed_at')->count())->toBe(0);
});

it('migrates a seeded database again', function () {
    LoadWorld::ensure();

    $dir = sys_get_temp_dir().'/load-migration-'.getmypid();
    @mkdir($dir);
    file_put_contents("{$dir}/2099_01_01_000000_create_load_probe_table.php", <<<'PHP'
        <?php

        use Illuminate\Database\Migrations\Migration;
        use Illuminate\Database\Schema\Blueprint;
        use Illuminate\Support\Facades\Schema;

        return new class extends Migration
        {
            public function up(): void
            {
                Schema::create('load_probe', fn (Blueprint $table) => $table->id());
            }

            public function down(): void
            {
                Schema::drop('load_probe');
            }
        };
        PHP);

    try {
        // an open migration, as a later task brings one: the next ensure() runs it on the seeded database
        app('migrator')->path($dir);
        LoadWorld::forget();
        LoadWorld::ensure();

        expect(Schema::hasTable('load_probe'))->toBeTrue()
            ->and(DB::table('work_items')->count())->toBe(50_000);
    } finally {
        Artisan::call('migrate:rollback', ['--path' => $dir, '--realpath' => true, '--force' => true]);
        @unlink("{$dir}/2099_01_01_000000_create_load_probe_table.php");
        @rmdir($dir);
    }

    expect(Schema::hasTable('load_probe'))->toBeFalse();
});
