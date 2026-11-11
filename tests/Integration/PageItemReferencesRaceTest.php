<?php

use App\Access\ProjectRole;
use App\Actions\Pages\UpdatePage;
use App\Actions\WorkItems\DeleteWorkItem;
use App\Models\Attachment;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\Document;
use App\Support\PageItemReferences;
use Illuminate\Support\Facades\DB;
use Tests\Support\RaceConnections;
use Tests\Support\RichTextFixtures as F;

/*
 * A page names an item while the item is deleted (Task 21t, A456): PageItemReferences::sync reads which items there are
 * without a lock and writes its rows with `insertOrIgnore`, so a deletion that commits in between leaves no row on an
 * item that is gone and no 500; a save that wrote its row first holds the item until its commit, then the row goes with
 * the item. `mariadb` holds its transaction open like a request in progress, `mariadb_second` is the other request.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** WEB with Mara as its admin, items A and B, and a page of Mara that names B. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    [$a, $b] = WorkItem::factory()->for($web)->count(2)->create(['created_by' => $mara->id])->all();
    $page = Page::factory()->create(['project_id' => $web->id, 'created_by' => $mara->id, 'updated_by' => $mara->id]);

    return [$page, $mara, $a, $b];
};

$rows = fn (): array => DB::table('page_item_references')->orderBy('work_item_id')->pluck('work_item_id')->all();

it('writes no row for an item a deletion takes away while the page is saved', function () use ($world, $rows) {
    [$page, $mara, $a, $b] = $world();

    RaceConnections::hold(fn () => DeleteWorkItem::run(actor($mara), $a));
    // the save reads A as there (the deletion is not committed), then its row waits for the item: the deletion commits
    RaceConnections::releaseBefore('insert ignore into `page_item_references`');

    $saved = RaceConnections::second(fn () => UpdatePage::run(actor($mara), $page, ['content_json' => F::doc(F::p(F::reference($a->id), ' ', F::reference($b->id)))]));

    expect($saved)->toBeInstanceOf(Page::class)
        ->and(WorkItem::query()->find($a->id))->toBeNull()
        ->and($rows())->toBe([$b->id]);
});

it('takes the row of a saved page with the item it names', function () use ($world, $rows) {
    [$page, $mara, $a, $b] = $world();

    RaceConnections::hold(fn () => UpdatePage::run(actor($mara), $page, ['content_json' => F::doc(F::p(F::reference($a->id), ' ', F::reference($b->id)))]));
    expect(DB::connection('mariadb')->table('page_item_references')->count())->toBe(2);
    // the save commits as the deletion asks for the item; the row goes with the item (cascade), never a 1451
    RaceConnections::releaseBeforeLock('work_items');

    $deleted = RaceConnections::second(fn () => DeleteWorkItem::run(actor($mara), $a));

    expect($deleted)->toBeNull()
        ->and(WorkItem::query()->find($a->id))->toBeNull()
        ->and($rows())->toBe([$b->id]);
});

it('saves a page that drops its reference and keeps the picture of the item a deletion takes', function () use ($world, $rows) {
    [$page, $mara, $a] = $world();
    $picture = Attachment::factory()->forItem($a)->create(['uploaded_by' => $mara->id]);
    $page->update(['content' => F::doc(F::p(F::reference($a->id)), F::image($picture->id, 'Entwurf'))]);
    PageItemReferences::sync($page, Document::fromJson($page->content));

    // the deletion holds A, the picture and (by cascade) the row of the page on A, like a request in progress
    RaceConnections::hold(fn () => DeleteWorkItem::run(actor($mara), $a));
    // the save asks for the picture before it touches its rows: the deletion commits there and hands the picture to
    // the page; a save that took the row first waited for it while the deletion waited for the picture (a deadlock)
    RaceConnections::releaseBeforeLock('attachments');

    $saved = RaceConnections::second(fn () => UpdatePage::run(actor($mara), $page, ['content_json' => F::doc(F::image($picture->id, 'Entwurf'))]));

    expect($saved)->toBeInstanceOf(Page::class)
        ->and(WorkItem::query()->find($a->id))->toBeNull()
        ->and($rows())->toBe([])
        ->and($picture->fresh()?->attachable_type)->toBe($page->getMorphClass())
        ->and($picture->fresh()?->attachable_id)->toBe($page->id);
});
