<?php

use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Support\RichTextFixtures as F;

/*
 * The migration 2026_11_08_000400_create_page_item_references, rolled back and run again on the migrations of the test
 * (DatabaseMigrations, K4): the table goes and comes back filled from the pages there are, in blocks of 500 pages; only
 * references of kind `item` to items there are, a text Document refuses names nothing. Versions count for nothing.
 */

const PAGE_REFERENCES_MIGRATION = 'database/migrations/2026_11_08_000400_create_page_item_references.php';

it('fills the table from the pages there are and takes it away again', function () {
    $author = User::factory()->create();
    $project = Project::factory()->create();
    [$a, $b] = WorkItem::factory()->for($project)->count(2)->create()->all();
    $gone = strtolower((string) Str::ulid());
    $refs = fn (string ...$ids) => F::doc(F::p('Siehe ', ...array_map(fn (string $id) => F::reference($id), $ids)));

    $this->artisan('migrate:rollback', ['--path' => PAGE_REFERENCES_MIGRATION])->assertSuccessful();
    expect(Schema::hasTable('page_item_references'))->toBeFalse();

    // 520 pages with a reference node, two blocks of 500: the first names A and B (A twice), the last B and an item
    // that is gone, the others only pages; 510 pages without a reference node (most with a key as text) are never read
    $row = fn (int $n, ?array $content) => [
        'id' => strtolower((string) Str::ulid()), 'project_id' => $project->id, 'rank' => sprintf('a%04d', $n), 'title' => "Seite {$n}",
        'content' => $content === null ? null : json_encode($content), 'version' => 1, 'created_by' => $author->id, 'updated_by' => $author->id,
    ];
    $pageRef = fn () => F::doc(F::p("{$a->key} als Text, Seite ", F::reference(strtolower((string) Str::ulid()), 'page')));
    $rows = array_map(fn (int $n) => $row($n, $pageRef()), range(1, 520));
    $rows[0] = $row(1, $refs($a->id, $b->id, $a->id));
    $rows[519] = $row(520, $refs($b->id, $gone));
    // a text Document refuses (a heading of level 7, a node it does not know) names nothing and is passed over
    $rows[300] = $row(301, ['type' => 'doc', 'content' => [['type' => 'heading', 'attrs' => ['level' => 7], 'content' => [F::reference($a->id)]]]]);
    $rows[301] = $row(302, ['type' => 'doc', 'content' => [['type' => 'nope', 'content' => [F::reference($a->id)]]]]);
    foreach (range(521, 1030) as $n) {
        $rows[] = $row($n, $n % 50 === 0 ? null : F::doc(F::p("{$a->key} als Text")));
    }
    DB::table('pages')->insert($rows);
    DB::table('page_versions')->insert(['id' => strtolower((string) Str::ulid()), 'page_id' => $rows[1]['id'], 'version' => 1, 'title' => 'Alt', 'content' => json_encode($refs($a->id)), 'author_id' => $author->id]);

    $reads = 0;
    DB::listen(function (QueryExecuted $query) use (&$reads) {
        if (str_starts_with($query->sql, 'select') && str_contains($query->sql, 'from `pages`')) {
            $reads++;
        }
    });

    foreach ([1, 2] as $round) {
        $reads = 0;
        $this->artisan('migrate')->assertSuccessful();

        $stored = DB::table('page_item_references')->orderBy('page_id')->orderBy('work_item_id')->get(['page_id', 'work_item_id'])
            ->map(fn (object $ref) => [$ref->page_id, $ref->work_item_id])->all();
        expect($stored)->toBe([
            [$rows[0]['id'], min($a->id, $b->id)], [$rows[0]['id'], max($a->id, $b->id)], [$rows[519]['id'], $b->id],
        ], "round {$round}")
            ->and(DB::table('page_item_references')->pluck('id')->every(fn (string $id) => Str::isUlid($id) && $id === strtolower($id)))->toBeTrue()
            // two blocks of pages with a reference node; the pages without one are not read
            ->and($reads)->toBe(2);

        $this->artisan('migrate:rollback', ['--path' => PAGE_REFERENCES_MIGRATION])->assertSuccessful();
        expect(Schema::hasTable('page_item_references'))->toBeFalse("rolled back, round {$round}");
    }

    $this->artisan('migrate')->assertSuccessful();
    expect(Page::query()->count())->toBe(1030)
        ->and(DB::table('page_item_references')->count())->toBe(3);
});
