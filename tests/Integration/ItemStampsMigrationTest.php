<?php

use App\Models\Project;
use App\Models\WorkItem;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Uid\Ulid;

/*
 * The migration 2026_11_08_000200_make_item_stamps_required, rolled back and run again on the migrations of the test
 * (DatabaseMigrations, K4): the stamps of items become required (A440). An item without one gets the time of its ULID,
 * the way back keeps the values, and neither column gets a default or an update of its own (K12).
 */

const ITEM_STAMPS_MIGRATION = 'database/migrations/2026_11_08_000200_make_item_stamps_required.php';

/** The definitions of both stamps in `SHOW CREATE TABLE work_items`. */
$definitions = function (): array {
    $create = (string) collect((array) DB::selectOne('show create table `work_items`'))->last();
    preg_match_all('/^\s*`(created_at|updated_at)` (.+?),?$/m', $create, $matches);

    return array_combine($matches[1], $matches[2]);
};

/** An item whose ULID was made at the given time (UTC). */
$itemAt = function (Project $project, string $at): WorkItem {
    $id = Str::lower(Ulid::generate(new DateTimeImmutable($at, new DateTimeZone('UTC'))));

    return WorkItem::factory()->create(['id' => $id, 'project_id' => $project->id]);
};

it('fills missing stamps from the ULID', function () use ($itemAt) {
    $project = Project::factory()->create();
    $none = $itemAt($project, '2026-10-01 08:00:00.750');
    $changed = $itemAt($project, '2026-10-02 09:30:00');
    $created = $itemAt($project, '2026-10-03 10:00:00');
    $whole = $itemAt($project, '2026-10-04 11:00:00');

    $this->artisan('migrate:rollback', ['--path' => ITEM_STAMPS_MIGRATION])->assertSuccessful();
    DB::table('work_items')->where('id', $none->id)->update(['created_at' => null, 'updated_at' => null]);
    DB::table('work_items')->where('id', $changed->id)->update(['created_at' => null, 'updated_at' => '2026-10-20 12:00:00']);
    DB::table('work_items')->where('id', $created->id)->update(['created_at' => '2026-10-05 07:00:00', 'updated_at' => null]);
    DB::table('work_items')->where('id', $whole->id)->update(['created_at' => '2026-10-06 07:00:00', 'updated_at' => '2026-10-07 07:00:00']);
    $this->artisan('migrate')->assertSuccessful();

    $stamps = DB::table('work_items')->orderBy('id')->get(['id', 'created_at', 'updated_at'])
        ->mapWithKeys(fn (object $row) => [$row->id => [$row->created_at, $row->updated_at]])->all();

    // the time of the ULID to the second; a change kept, a missing change is the creation
    expect($stamps)->toBe([
        $none->id => ['2026-10-01 08:00:00', '2026-10-01 08:00:00'],
        $changed->id => ['2026-10-02 09:30:00', '2026-10-20 12:00:00'],
        $created->id => ['2026-10-05 07:00:00', '2026-10-05 07:00:00'],
        $whole->id => ['2026-10-06 07:00:00', '2026-10-07 07:00:00'],
    ]);
});

it('keeps the values on the way back', function () use ($itemAt, $definitions) {
    $item = $itemAt(Project::factory()->create(), '2026-10-01 08:00:00');
    DB::table('work_items')->where('id', $item->id)->update(['created_at' => '2026-10-02 08:00:00', 'updated_at' => '2026-10-03 08:00:00']);

    // twice: the way back and forth works on a table it went through before
    foreach ([1, 2] as $round) {
        $this->artisan('migrate:rollback', ['--path' => ITEM_STAMPS_MIGRATION])->assertSuccessful();
        expect($definitions())->toBe([
            'created_at' => 'timestamp NULL DEFAULT NULL',
            'updated_at' => 'timestamp NULL DEFAULT NULL',
        ], "rolled back, round {$round}");

        $this->artisan('migrate')->assertSuccessful();
        expect((array) DB::table('work_items')->where('id', $item->id)->first(['created_at', 'updated_at']))
            ->toBe(['created_at' => '2026-10-02 08:00:00', 'updated_at' => '2026-10-03 08:00:00'], "migrated, round {$round}");
    }
});

it('has no default and no on-update on the stamps', function () use ($definitions) {
    // `explicit_defaults_for_timestamp` off would give the first of them DEFAULT and ON UPDATE CURRENT_TIMESTAMP
    expect($definitions())->toBe([
        'created_at' => 'timestamp NOT NULL',
        'updated_at' => 'timestamp NOT NULL',
    ]);

    // a row without them is refused, never stamped by the database
    $item = WorkItem::factory()->make(['project_id' => Project::factory()->create()->id]);
    $row = array_diff_key($item->getAttributes(), ['created_at' => true, 'updated_at' => true]);

    expect(fn () => DB::table('work_items')->insert([...$row, 'id' => Str::lower((string) Str::ulid())]))
        ->toThrow(QueryException::class, "Field 'created_at' doesn't have a default value");
});
