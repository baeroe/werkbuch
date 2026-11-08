<?php

namespace Database\Seeders;

use App\Access\RoleAssignments;
use App\Search\SearchIndexer;
use Database\Seeders\Demo\CatalogSeeder;
use Database\Seeders\Demo\OrganizationSeeder;
use Database\Seeders\Load\LoadCatalog;
use Database\Seeders\Load\LoadContent;
use Database\Seeders\Load\LoadItems;
use Database\Seeders\Load\LoadRandom;
use Database\Seeders\Load\LoadTexts;
use Faker\Factory;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

/**
 * The data of the load suite (tests/Load, phpunit.load.xml): the demo organization and catalog, 30 people, 5 bots, 20
 * projects with 2 500 items each (50 000) and their history (`events`), 5 000 relations, 100 000 comments, 2 000 wiki
 * pages in L01, 200 templates, 50 switched-off webhooks and the file list of the first epic of every project; only
 * fictional names. Deterministic (LoadRandom with seed 15, Faker seed 15) apart from the ULIDs, the UUIDs of the media
 * and the moment of the schedules. Written by bulk inserts without the app's events (A86), the history as rows of its
 * own (LoadHistory); the texts come from a fixed pool of Tiptap JSON, never from Markdown (K9). At the end the search index is built anew and the table `load_meta` names the
 * version and the numbers: LoadWorld::ensure() seeds again when they are missing or the version differs.
 *
 * Only for the database `load` with the search prefix `load_` (K8): anything else is refused before the first write.
 * Every change to this seeder or its classes raises VERSION.
 */
class LoadSeeder extends Seeder
{
    use WithoutModelEvents;

    public const VERSION = 2;

    public const DATABASE = 'load';

    public const PREFIX = 'load_';

    /** The tables `load_meta` counts; a seeded database has every one of them. */
    public const COUNTED = ['users', 'projects', 'work_items', 'work_item_values', 'work_item_labels', 'work_item_relations', 'comments', 'pages', 'page_versions', 'templates', 'webhooks', 'events', 'attachments'];

    public function run(RoleAssignments $roles): void
    {
        self::guard();

        $started = microtime(true);
        LoadRandom::seed();
        $faker = Factory::create('de_DE');
        $faker->seed(15);

        $this->call([OrganizationSeeder::class, CatalogSeeder::class]);
        $frame = (new LoadCatalog($roles, $faker))->run();
        $texts = new LoadTexts($frame['people']);
        $items = (new LoadItems($frame, $texts))->run();
        (new LoadContent($frame, $items, $texts))->run();
        $seeded = microtime(true);

        app(SearchIndexer::class)->rebuild();
        $rebuilt = microtime(true);

        self::meta([
            'version' => self::VERSION,
            ...array_combine(self::COUNTED, array_map(fn (string $table) => DB::table($table)->count(), self::COUNTED)),
            'seed_seconds' => round($seeded - $started, 1),
            'rebuild_seconds' => round($rebuilt - $seeded, 1),
            'peak_memory_mb' => round(memory_get_peak_usage(true) / 1_048_576),
            'seeded_at' => now()->toIso8601String(),
        ]);
    }

    /**
     * Refuses every database but `load` and every search prefix but `load_`: the seeder writes 50 000 items and empties
     * the indexes of its prefix.
     */
    public static function guard(): void
    {
        $database = DB::getDatabaseName();
        if ($database !== self::DATABASE) {
            throw new RuntimeException("The load data go only into the database `load`, not `{$database}`: run the load suite with phpunit.load.xml.");
        }

        $prefix = config('scout.prefix');
        if ($prefix !== self::PREFIX) {
            throw new RuntimeException('The load data use only the search prefix `load_`, not `'.(is_string($prefix) ? $prefix : '').'`: run the load suite with phpunit.load.xml.');
        }
    }

    /**
     * Writes values to `load_meta` (made here, it exists only in `load`), replacing those of the same name.
     *
     * @param  array<string, scalar>  $values
     */
    public static function meta(array $values): void
    {
        if (! Schema::hasTable('load_meta')) {
            Schema::create('load_meta', function (Blueprint $table): void {
                $table->string('name', 64)->primary();
                $table->string('value');
            });
        }

        DB::table('load_meta')->upsert(
            array_map(fn (string $name, mixed $value) => ['name' => $name, 'value' => (string) $value], array_keys($values), $values),
            ['name'],
            ['value'],
        );
    }
}
