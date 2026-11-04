<?php

use App\Access\ProjectRole;
use App\Actions\Pages\UpdatePage;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use Tests\Support\RaceConnections;

/*
 * Two windows save the same page on the same base version (Review Focus „Kein stiller Datenverlust“): UpdatePage
 * compares `base_version` with the version of the page under its lock (PageLock::page, the page `for update`), so the
 * second save waits for the first and then sees the version it left: one page and one 409 `page_conflict`, never a
 * silent overwrite. `mariadb` holds its transaction open like a request in progress, `mariadb_second` is the other
 * request and gives up waiting for a lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/** WEB with two members and a page of Mara in version 1. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $erik = memberOf($web, ProjectRole::Member, ['name' => 'Erik']);

    return [Page::factory()->create(['project_id' => $web->id, 'created_by' => $mara->id]), $mara, $erik];
};

it('makes a second save of the page wait for the first', function () use ($world) {
    [$page, $mara, $erik] = $world();

    RaceConnections::hold(fn () => UpdatePage::run(actor($mara), $page, ['content' => 'Fassung von Mara', 'base_version' => 1]));

    RaceConnections::expectLockWait(RaceConnections::second(fn () => UpdatePage::run(actor($erik), $page, ['content' => 'Fassung von Erik', 'base_version' => 1])), 'pages');

    RaceConnections::release();

    expect($page->fresh()?->content_text)->toBe('Fassung von Mara');
});

it('two saves on the same base version give one page and one conflict', function () use ($world) {
    [$page, $mara, $erik] = $world();

    RaceConnections::hold(fn () => UpdatePage::run(actor($mara), $page, ['content' => 'Fassung von Mara', 'base_version' => 1]));
    RaceConnections::releaseBeforeLock('pages');

    $second = RaceConnections::second(fn () => UpdatePage::run(actor($erik), $page, ['content' => 'Fassung von Erik', 'base_version' => 1]));
    $stored = $page->fresh();

    expect($second)->toBeInstanceOf(Problem::class);
    assert($second instanceof Problem);
    expect([$second->status, $second->reason, $second->detail])->toBe([409, 'page_conflict', __('problem.detail.page_conflict', ['name' => 'Mara'])])
        ->and($second->extensions['current']['version'])->toBe(2)
        ->and($second->extensions['current']['content'])->toBe('Fassung von Mara')
        ->and($stored?->content_text)->toBe('Fassung von Mara')
        ->and($stored?->version)->toBe(2)
        ->and(PageVersion::query()->count())->toBe(0);
});
