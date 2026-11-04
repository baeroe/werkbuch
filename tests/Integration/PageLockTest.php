<?php

use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\Project;
use App\Support\CatalogLock;
use App\Support\PageLock;
use Illuminate\Support\Facades\DB;
use Tests\Support\RaceConnections;

/*
 * The locks of a change of the wiki: a tree change holds the project for update, a change of a page holds the project
 * shared and the page for update, never the organization. Two connections as in ItemLockTest: `mariadb` holds its
 * transaction open like a request in progress, `mariadb_second` is the other request and gives up after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('tree waits on a shared page lock of the same project', function () {
    $page = Page::factory()->create();
    $other = Page::factory()->create();

    // connection 1: a save of the page holds its project shared and the page for update
    RaceConnections::hold(fn () => PageLock::page($page));

    // connection 2: a tree change of another project goes ahead, one of the same project waits
    $elsewhere = RaceConnections::second(fn () => DB::transaction(fn () => PageLock::tree($other->project)));
    $outcome = RaceConnections::second(fn () => DB::transaction(fn () => PageLock::tree($page->project)));

    expect($elsewhere instanceof Project ? $elsewhere->id : null)->toBe($other->project_id);
    RaceConnections::expectLockWait($outcome, 'projects');

    RaceConnections::release();

    $locked = RaceConnections::second(fn () => DB::transaction(fn () => PageLock::tree($page->project)));

    expect($locked instanceof Project ? $locked->id : null)->toBe($page->project_id);
});

it('page waits on a tree change', function () {
    $page = Page::factory()->create();

    // connection 1: a tree change holds the project for update
    RaceConnections::hold(fn () => PageLock::tree($page->project));

    $outcome = RaceConnections::second(fn () => DB::transaction(fn () => PageLock::page($page)));

    RaceConnections::expectLockWait($outcome, 'projects', null, 'lock in share mode');

    RaceConnections::release();

    $locked = RaceConnections::second(fn () => DB::transaction(fn () => PageLock::page($page)));

    expect($locked instanceof Page ? [$locked->id, $locked->project->id] : null)->toBe([$page->id, $page->project_id]);
});

it('lets two saves of different pages share the project, the same page waits', function () {
    $page = Page::factory()->create();
    $sibling = Page::factory()->create(['project_id' => $page->project_id]);

    RaceConnections::hold(fn () => PageLock::page($page));

    $other = RaceConnections::second(fn () => DB::transaction(fn () => PageLock::page($sibling)));

    expect($other instanceof Page ? $other->id : null)->toBe($sibling->id);
    RaceConnections::expectLockWait(RaceConnections::second(fn () => DB::transaction(fn () => PageLock::page($page))), 'pages');
});

it('never waits for a change of the catalogs', function () {
    $page = Page::factory()->create();

    // connection 1: a change of the catalogs holds the organization for update
    RaceConnections::hold(fn () => CatalogLock::take());

    $tree = RaceConnections::second(fn () => DB::transaction(fn () => PageLock::tree($page->project)));
    $locked = RaceConnections::second(fn () => DB::transaction(fn () => PageLock::page($page)));

    expect($tree)->toBeInstanceOf(Project::class)
        ->and($locked)->toBeInstanceOf(Page::class);
});

it('refuses an archived project and one being deleted', function () {
    $archived = Page::factory()->create(['project_id' => Project::factory()->archived()->create()->id]);
    $deleting = Page::factory()->create();
    $deleting->project->update(['deleting_at' => now()]);

    $status = function (Closure $lock): array {
        try {
            DB::transaction($lock);
        } catch (Problem $problem) {
            return [$problem->status, $problem->reason, $problem->detail];
        }

        return [];
    };

    $conflict = [409, 'project_archived', __('problem.detail.project_archived')];

    expect($status(fn () => PageLock::tree($archived->project)))->toBe($conflict)
        ->and($status(fn () => PageLock::page($archived)))->toBe($conflict)
        ->and($status(fn () => PageLock::tree($deleting->project))[0] ?? null)->toBe(404)
        ->and($status(fn () => PageLock::page($deleting))[0] ?? null)->toBe(404);
});

it('answers 404 for a page or a project deleted meanwhile', function () {
    $page = Page::factory()->create();
    $gone = Page::factory()->create();
    $project = $gone->project;
    Page::query()->whereKey($page->id)->delete();
    $project->delete();

    expect(fn () => DB::transaction(fn () => PageLock::page($page)))->toThrow(Problem::class)
        ->and(fn () => DB::transaction(fn () => PageLock::page($gone)))->toThrow(Problem::class)
        ->and(fn () => DB::transaction(fn () => PageLock::tree($project)))->toThrow(Problem::class);
});
