<?php

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
    config(['database.connections.mariadb.database' => 'testing']);
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
        ->and($refused?->getMessage())->toContain('testing')
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
        ->and(DB::table('templates')->count())->toBe(200)
        ->and(DB::table('templates')->whereNotNull('schedule')->count())->toBe(50)
        ->and(DB::table('templates')->whereNotNull('schedule')->distinct()->count('next_run_at'))->toBe(1)
        ->and(DB::table('webhooks')->count())->toBe(50)
        ->and(DB::table('webhooks')->where('active', true)->count())->toBe(0)
        ->and(DB::table('users')->where('email', 'like', 'load-%@example.com')->count())->toBe(30)
        ->and(DB::table('users')->where('type', 'bot')->where('is_default_bot', false)->count())->toBe(5)
        ->and(DB::table('load_meta')->where('name', 'version')->value('value'))->toBe((string) LoadSeeder::VERSION)
        ->and(DB::table('load_meta')->where('name', 'work_items')->value('value'))->toBe('50000');

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

    expect($epic?->n)->toBe(40)
        ->and($depth((string) $deepest))->toBe(4)
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
