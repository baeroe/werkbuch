<?php

use App\Access\ProjectRole;
use App\Actions\Pages\DeletePage;
use App\Events\EventType;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
 * Deleting a page with its whole subtree (Task 6, A310, K1): every page below it and their versions go with it, under
 * the tree lock; one `page.deleted` names the root and, in `meta.page_ids`, every page that went (the root first). WEB
 * (public) with Mara as its admin, Jonas as a member and Lene as a viewer; its wiki:
 *   Start > Ablauf > Schritte, Glossar
 *   Team
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas', 'handle' => 'jonas']);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $top = fn (string $title, string $rank) => Page::factory()->create(['project_id' => $web->id, 'title' => $title, 'rank' => $rank, 'created_by' => $mara->id]);
    $start = $top('Start', 'a0');
    $team = $top('Team', 'a1');
    $flow = Page::factory()->childOf($start)->create(['title' => 'Ablauf', 'rank' => 'a0']);
    $glossary = Page::factory()->childOf($start)->create(['title' => 'Glossar', 'rank' => 'a1']);
    $steps = Page::factory()->childOf($flow)->create(['title' => 'Schritte', 'rank' => 'a0']);

    return compact('mara', 'web', 'jonas', 'lene', 'start', 'team', 'flow', 'glossary', 'steps');
};

$delete = fn (User $user, Page $page): int => DeletePage::run(actor($user), $page);

it('deletes a page with its whole subtree, their versions and item references, and answers how many', function () use ($world, $delete) {
    $w = $world();
    $item = WorkItem::factory()->for($w['web'])->create();
    foreach (['start', 'steps', 'team'] as $key) {
        PageVersion::factory()->create(['page_id' => $w[$key]->id]);
        DB::table('page_item_references')->insert(['id' => strtolower((string) Str::ulid()), 'page_id' => $w[$key]->id, 'work_item_id' => $item->id]);
    }
    // read from the row: building the world (members, the item's number) may touch the project a second later
    $touched = $w['web']->fresh()?->updated_at?->toJSON();
    Carbon::setTestNow(now()->addHour());

    $deleted = $delete($w['jonas'], $w['start']);

    expect($deleted)->toBe(4)
        ->and(Page::query()->pluck('title')->all())->toBe(['Team'])
        ->and(PageVersion::query()->pluck('page_id')->all())->toBe([$w['team']->id])
        // the items they referenced stay, only the rows of the pages go (cascade, A456)
        ->and(DB::table('page_item_references')->pluck('page_id')->all())->toBe([$w['team']->id])
        ->and($item->fresh())->not->toBeNull()
        // a deletion in the wiki is no change of the project
        ->and($w['web']->fresh()?->updated_at?->toJSON())->toBe($touched);
});

it('records one page.deleted with the ids of the subtree', function () use ($world, $delete) {
    $w = $world();

    $delete($w['mara'], $w['start']);

    $event = eventsOf(EventType::PageDeleted)->sole();
    expect($event->subject_type)->toBe('page')
        ->and($event->subject_id)->toBe($w['start']->id)
        ->and($event->actor_id)->toBe($w['mara']->id)
        ->and($event->project_id)->toBe($w['web']->id)
        ->and($event->changes)->toBeNull()
        // the root first, then level by level in the order of the siblings (A310)
        ->and($event->meta)->toMatchArray(['title' => 'Start', 'page_ids' => [$w['start']->id, $w['flow']->id, $w['glossary']->id, $w['steps']->id]]);
});

it('deletes a leaf alone', function () use ($world, $delete) {
    $w = $world();

    expect($delete($w['jonas'], $w['glossary']))->toBe(1)
        ->and(Page::query()->orderBy('title')->pluck('title')->all())->toBe(['Ablauf', 'Schritte', 'Start', 'Team'])
        ->and(eventsOf(EventType::PageDeleted)->sole()->meta)->toMatchArray(['page_ids' => [$w['glossary']->id]]);
});

it('deletes a chain of 20 pages (K1)', function () use ($world, $delete) {
    $w = $world();
    // deeper than the 15 levels InnoDB cascades: the subtree goes in one statement with its tree loosened first
    $page = $w['team'];
    foreach (range(1, 19) as $level) {
        $page = Page::factory()->childOf($page)->create(['title' => "Ebene {$level}"]);
        PageVersion::factory()->create(['page_id' => $page->id]);
    }

    expect($delete($w['mara'], $w['team']))->toBe(20)
        ->and(Page::query()->orderBy('title')->pluck('title')->all())->toBe(['Ablauf', 'Glossar', 'Schritte', 'Start'])
        ->and(PageVersion::query()->count())->toBe(0);
});

it('refuses a viewer and an archived project', function () use ($world, $delete) {
    $w = $world();
    $private = Page::factory()->create(['project_id' => Project::factory()->private()->create()->id]);

    $viewer = problemOf(fn () => $delete($w['lene'], $w['start']));
    $hidden = problemOf(fn () => $delete($w['jonas'], $private));
    $w['web']->update(['archived_at' => now()]);
    $archived = problemOf(fn () => $delete($w['mara'], $w['start']));

    expect([$viewer->status, $viewer->detail])->toBe([403, __('problem.detail.wiki_members_only')])
        ->and([$hidden->status, $hidden->detail])->toBe([404, null])
        ->and([$archived->status, $archived->reason])->toBe([409, 'project_archived'])
        ->and(Page::query()->count())->toBe(6)
        ->and(eventsOf(EventType::PageDeleted))->toHaveCount(0);
});

it('answers 404 for a page that is gone meanwhile, without a second event', function () use ($world, $delete) {
    $w = $world();
    $stale = Page::query()->findOrFail($w['flow']->id);

    $delete($w['mara'], $w['flow']);
    $again = problemOf(fn () => $delete($w['mara'], $stale));
    $w['web']->forceFill(['deleting_at' => now()])->save();
    $deleting = problemOf(fn () => $delete($w['mara'], $w['team']));

    expect([$again->status, $again->detail])->toBe([404, null])
        ->and($deleting->status)->toBe(404)
        ->and(Page::query()->count())->toBe(3)
        ->and(eventsOf(EventType::PageDeleted))->toHaveCount(1);
});

it('deletes a page over REST and answers how many went', function () use ($world) {
    $w = $world();

    $this->actingAs($w['jonas'])->deleteJson('/api/v1/pages/'.strtoupper($w['flow']->id))->assertOk()->assertExactJson(['deleted' => 2]);
    $this->actingAs($w['lene'])->deleteJson("/api/v1/pages/{$w['team']->id}")->assertForbidden();
    $this->actingAs($w['jonas'])->deleteJson("/api/v1/pages/{$w['flow']->id}")->assertNotFound()->assertJsonMissingPath('detail');

    expect(Page::query()->orderBy('title')->pluck('title')->all())->toBe(['Glossar', 'Start', 'Team']);
});
