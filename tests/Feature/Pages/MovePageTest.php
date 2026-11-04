<?php

use App\Access\ProjectRole;
use App\Actions\Pages\MovePage;
use App\Actions\Pages\UpdatePage;
use App\Events\EventType;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Carbon;

/*
 * Moving a page in the tree (Task 5): under `parent_id` (`null`: the top level), in front of the sibling `before_id`
 * (`null`: at the end). Under PageLock::tree, never into the page itself or its subtree, the rank from the neighbours
 * (PageRanks::between) and, when there is no room left between them, new ranks for the whole row of siblings without an
 * event and without touching their time stamps (A320, K13). A move is no save: version, updated_at and updated_by stay.
 * WEB (public) with Mara as its admin, Jonas as a member and Lene as a viewer; its wiki:
 *   Start (a0) > Ablauf (a0), Glossar (a1)
 *   Team (a1) > Rollen (a0)
 *   Archiv (a2)
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas', 'handle' => 'jonas']);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $top = fn (string $title, string $rank) => Page::factory()->create(['project_id' => $web->id, 'title' => $title, 'rank' => $rank, 'created_by' => $mara->id]);
    $start = $top('Start', 'a0');
    $team = $top('Team', 'a1');
    $archive = $top('Archiv', 'a2');
    $flow = Page::factory()->childOf($start)->create(['title' => 'Ablauf', 'rank' => 'a0']);
    $glossary = Page::factory()->childOf($start)->create(['title' => 'Glossar', 'rank' => 'a1']);
    $roles = Page::factory()->childOf($team)->create(['title' => 'Rollen', 'rank' => 'a0']);

    return compact('mara', 'web', 'jonas', 'lene', 'start', 'team', 'archive', 'flow', 'glossary', 'roles');
};

$move = fn (User $user, Page $page, ?string $parentId, ?string $beforeId): Page => MovePage::run(actor($user), $page, ['parent_id' => $parentId, 'before_id' => $beforeId]);

/** The titles of the siblings below the parent (`null`: the top level) in their order, byte by byte. */
$row = fn (Project $project, ?string $parentId): array => Page::query()->where('project_id', $project->id)->where('parent_id', $parentId)
    ->orderBy('rank')->orderBy('id')->pluck('title')->all();

it('moves a page under another page, in front of a sibling', function () use ($world, $move, $row) {
    $w = $world();

    // ULIDs in any case
    $moved = $move($w['jonas'], $w['archive'], strtoupper($w['start']->id), strtoupper($w['glossary']->id));

    expect($moved->parent_id)->toBe($w['start']->id)
        ->and(strcmp($moved->rank, 'a0'))->toBeGreaterThan(0)
        ->and(strcmp($moved->rank, 'a1'))->toBeLessThan(0)
        ->and($moved->lean)->toBeFalse()
        ->and($row($w['web'], $w['start']->id))->toBe(['Ablauf', 'Archiv', 'Glossar'])
        ->and($row($w['web'], null))->toBe(['Start', 'Team']);

    $event = eventsOf(EventType::PageMoved, $w['archive'])->sole();
    expect($event->actor_id)->toBe($w['jonas']->id)
        ->and($event->project_id)->toBe($w['web']->id)
        ->and($event->changes)->toBe([
            'parent_id' => ['old' => null, 'new' => $w['start']->id],
            'rank' => ['old' => 'a2', 'new' => $moved->rank],
        ]);
});

it('moves a page to the top level at the end, and to the front of its own row', function () use ($world, $move, $row) {
    $w = $world();

    $moved = $move($w['mara'], $w['glossary'], null, null);
    $front = $move($w['mara'], $w['team'], null, $w['start']->id);

    expect($moved->parent_id)->toBeNull()
        ->and($row($w['web'], null))->toBe(['Team', 'Start', 'Archiv', 'Glossar'])
        ->and($row($w['web'], $w['start']->id))->toBe(['Ablauf'])
        ->and(eventsOf(EventType::PageMoved, $w['glossary'])->sole()->changes)->toBe([
            'parent_id' => ['old' => $w['start']->id, 'new' => null],
            'rank' => ['old' => 'a1', 'new' => $moved->rank],
        ])
        // the place in the row changes, the parent stays: the event names both
        ->and(eventsOf(EventType::PageMoved, $w['team'])->sole()->changes)->toBe([
            'parent_id' => ['old' => null, 'new' => null],
            'rank' => ['old' => 'a1', 'new' => $front->rank],
        ]);
});

it('takes the subtree along', function () use ($world, $move, $row) {
    $w = $world();
    $deep = Page::factory()->childOf($w['roles'])->create(['title' => 'Pflichten']);

    $move($w['mara'], $w['team'], $w['archive']->id, null);

    expect($row($w['web'], null))->toBe(['Start', 'Archiv'])
        ->and($row($w['web'], $w['archive']->id))->toBe(['Team'])
        ->and($w['roles']->fresh()?->parent_id)->toBe($w['team']->id)
        ->and($deep->fresh()?->parent_id)->toBe($w['roles']->id)
        // only the page itself moved
        ->and(eventsOf(EventType::PageMoved))->toHaveCount(1);
});

it('refuses a move into the page itself or its subtree with field.parent_page.cycle', function () use ($world, $move) {
    $w = $world();
    $deep = Page::factory()->childOf($w['roles'])->create(['title' => 'Pflichten']);

    foreach ([$w['team'], $w['roles'], $deep] as $below) {
        expect(invalidOf(fn () => $move($w['mara'], $w['team'], $below->id, null)))->toBe(['parent_id' => [__('field.parent_page.cycle')]]);
    }

    expect($w['team']->fresh()?->parent_id)->toBeNull()
        ->and($w['team']->fresh()?->rank)->toBe('a1')
        ->and(eventsOf(EventType::PageMoved))->toBeEmpty();
});

it('refuses a parent of another project, an unknown parent and a before_id that is no sibling', function () use ($world, $move) {
    $w = $world();
    $elsewhere = Page::factory()->create(['project_id' => Project::factory()->create()->id]);
    $unknown = '01jzzzzzzzzzzzzzzzzzzzzzzz';

    // a page of another project is the same as an unknown one (K8, PageTree::wouldCycle knows neither)
    expect(invalidOf(fn () => $move($w['mara'], $w['archive'], $elsewhere->id, null)))->toBe(['parent_id' => [__('field.parent_page.unknown')]])
        ->and(invalidOf(fn () => $move($w['mara'], $w['archive'], $unknown, null)))->toBe(['parent_id' => [__('field.parent_page.unknown')]])
        ->and(invalidOf(fn () => MovePage::run(actor($w['mara']), $w['archive'], ['parent_id' => 7, 'before_id' => null])))->toBe(['parent_id' => [__('field.parent_page.unknown')]])
        // a page below another parent, the page itself, an unknown id and anything but text are no siblings
        ->and(invalidOf(fn () => $move($w['mara'], $w['archive'], $w['start']->id, $w['roles']->id)))->toBe(['before_id' => [__('field.before_id.sibling')]])
        ->and(invalidOf(fn () => $move($w['mara'], $w['archive'], null, $w['archive']->id)))->toBe(['before_id' => [__('field.before_id.sibling')]])
        ->and(invalidOf(fn () => $move($w['mara'], $w['archive'], null, $unknown)))->toBe(['before_id' => [__('field.before_id.sibling')]])
        ->and(invalidOf(fn () => MovePage::run(actor($w['mara']), $w['archive'], ['parent_id' => $elsewhere->id, 'before_id' => ['x']])))->toBe([
            'parent_id' => [__('field.parent_page.unknown')],
            'before_id' => [__('field.before_id.sibling')],
        ])
        ->and($w['archive']->fresh()?->rank)->toBe('a2')
        ->and(eventsOf(EventType::PageMoved))->toBeEmpty();
});

it('refuses a move without parent_id or before_id', function () use ($world) {
    $w = $world();

    expect(invalidOf(fn () => MovePage::run(actor($w['mara']), $w['archive'], [])))->toBe([
        'parent_id' => [__('field.required')],
        'before_id' => [__('field.required')],
    ])
        ->and(invalidOf(fn () => MovePage::run(actor($w['mara']), $w['archive'], ['parent_id' => null])))->toBe(['before_id' => [__('field.required')]]);
});

it('refuses a viewer, a page that is gone and an archived project', function () use ($world, $move) {
    $w = $world();

    $viewer = problemOf(fn () => $move($w['lene'], $w['archive'], null, null));
    expect([$viewer->status, $viewer->detail])->toBe([403, __('problem.detail.wiki_members_only')]);

    $gone = Page::factory()->create(['project_id' => $w['web']->id]);
    Page::query()->whereKey($gone->id)->delete();
    $missing = problemOf(fn () => $move($w['mara'], $gone, null, null));
    expect([$missing->status, $missing->detail])->toBe([404, null]);

    $w['web']->update(['archived_at' => now()]);
    $archived = problemOf(fn () => $move($w['mara'], $w['archive'], $w['start']->id, null));
    expect([$archived->status, $archived->reason])->toBe([409, 'project_archived'])
        ->and(eventsOf(EventType::PageMoved))->toBeEmpty();
});

it('changes nothing and records nothing for the same place', function () use ($world, $move) {
    $w = $world();

    foreach ([
        [$w['archive'], null, null],
        [$w['start'], null, $w['team']->id],
        [$w['flow'], $w['start']->id, $w['glossary']->id],
        [$w['glossary'], $w['start']->id, null],
    ] as [$page, $parent, $before]) {
        $same = $move($w['mara'], $page, $parent, $before);

        expect($same->rank)->toBe($page->rank)
            ->and($same->parent_id)->toBe($page->parent_id);
    }

    expect(eventsOf(EventType::PageMoved))->toBeEmpty();
});

it('keeps version, updated_at and updated_by, so an open editor saves on its base afterwards', function () use ($world, $move) {
    $w = $world();
    Carbon::setTestNow('2026-11-04 09:00:00');
    $w['archive']->update(['version' => 4, 'updated_by' => $w['mara']->id]);
    $before = $w['archive']->fresh();

    Carbon::setTestNow('2026-11-04 09:05:00');
    $move($w['jonas'], $w['archive'], $w['team']->id, null);
    $after = $w['archive']->fresh();

    expect($after?->parent_id)->toBe($w['team']->id)
        ->and($after?->version)->toBe(4)
        ->and($after?->updated_by)->toBe($w['mara']->id)
        ->and($after?->updated_at?->toIso8601String())->toBe($before?->updated_at?->toIso8601String());

    // Mara's editor still has version 4 as its base
    $saved = UpdatePage::run(actor($w['mara']), $w['archive'], ['title' => 'Archiv alt', 'base_version' => 4]);
    expect($saved->version)->toBe(5)
        ->and($saved->parent_id)->toBe($w['team']->id);
});

it('spreads the ranks of the siblings anew when a rank would get longer than 128 characters, and keeps their time stamps', function () use ($world, $move, $row) {
    $w = $world();
    Carbon::setTestNow('2026-11-04 09:00:00');
    // no room between Ablauf and Glossar: any rank between them has 129 characters
    $w['glossary']->update(['rank' => 'a0'.str_repeat('0', 125).'1', 'version' => 3]);
    $siblings = Page::query()->whereIn('id', [$w['flow']->id, $w['glossary']->id])->get()->keyBy('id');

    Carbon::setTestNow('2026-11-04 10:00:00');
    $moved = $move($w['jonas'], $w['archive'], $w['start']->id, $w['glossary']->id);

    $ranks = Page::query()->where('parent_id', $w['start']->id)->orderBy('rank')->pluck('rank')->all();
    expect($row($w['web'], $w['start']->id))->toBe(['Ablauf', 'Archiv', 'Glossar'])
        ->and(array_map(strlen(...), $ranks))->each->toBeLessThanOrEqual(128)
        ->and($ranks)->toContain($moved->rank);

    foreach ([$w['flow'], $w['glossary']] as $sibling) {
        $fresh = $sibling->fresh();
        $was = $siblings[$sibling->id];
        // K13: a sibling's pause before the next version is measured at updated_at, the move must not reset it
        expect($fresh?->updated_at?->toIso8601String())->toBe($was->updated_at?->toIso8601String())
            ->and($fresh?->version)->toBe($was->version)
            ->and($fresh?->updated_by)->toBe($was->updated_by);
    }

    // the new ranks of the siblings are no event, only the move is
    expect(eventsOf(EventType::PageMoved))->toHaveCount(1)
        ->and(eventsOf(EventType::PageUpdated))->toBeEmpty();
});

it('spreads the ranks of the siblings anew when two of them share a rank', function () use ($world, $move, $row) {
    $w = $world();
    $w['glossary']->update(['rank' => 'a0']);

    $moved = $move($w['mara'], $w['archive'], $w['start']->id, $w['glossary']->id);

    $ranks = Page::query()->where('parent_id', $w['start']->id)->orderBy('rank')->pluck('rank')->all();
    expect($row($w['web'], $w['start']->id))->toBe(['Ablauf', 'Archiv', 'Glossar'])
        ->and(array_unique($ranks))->toHaveCount(3)
        ->and($ranks[1])->toBe($moved->rank);
});
