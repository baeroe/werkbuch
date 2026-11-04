<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Pages\UpdatePage;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Tests\Support\RichTextFixtures as F;

/*
 * Saving a page (Task 4, plan „Versionen und Konflikt“): a save on an outdated `base_version` is a 409 `page_conflict`;
 * before a save replaces a foreign state, a state that rested ten minutes or one the writer asks to keep, the stored
 * state stays as a version (VersionRule, A307, A308). `page.updated` names title, emoji and version, never the text
 * (A306). WEB (public) with Mara as its admin, Jonas as a member and Lene as a viewer.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas', 'handle' => 'jonas']);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);
    $page = Page::factory()->withText('Erste Fassung')->create([
        'project_id' => $web->id, 'title' => 'Ablauf', 'emoji' => '🚀', 'created_by' => $mara->id, 'updated_by' => $mara->id,
    ]);

    return compact('mara', 'web', 'jonas', 'lene', 'page');
};

$save = fn (User $user, Page $page, array $input): Page => UpdatePage::run(actor($user), $page, $input);

it('saves on top of the version it is based on', function () use ($world, $save) {
    $w = $world();

    $saved = $save($w['mara'], $w['page'], ['title' => ' Ablauf neu ', 'content' => 'Zweite **Fassung**', 'base_version' => 1]);
    $again = $save($w['mara'], $saved, ['content_json' => F::doc(F::p('Dritte Fassung')), 'base_version' => 2]);

    expect($saved->version)->toBe(2)
        ->and($saved->title)->toBe('Ablauf neu')
        ->and($saved->emoji)->toBe('🚀')
        ->and($saved->content_text)->toBe('Zweite Fassung')
        ->and($saved->lean)->toBeFalse()
        ->and($again->version)->toBe(3)
        ->and($again->title)->toBe('Ablauf neu')
        ->and($again->content)->toBe(F::doc(F::p('Dritte Fassung')))
        ->and($w['page']->fresh()?->version)->toBe(3)
        ->and(PageVersion::query()->count())->toBe(0)
        ->and(eventsOf(EventType::PageUpdated, $w['page']))->toHaveCount(2);
});

it('refuses an outdated base version with page_conflict, the current page and the name of the last editor, and writes nothing', function () use ($world, $save) {
    $w = $world();
    $w['page']->update(['version' => 3]);
    $before = $w['page']->fresh();

    $refused = problemOf(fn () => $save($w['jonas'], $w['page'], ['content' => 'Meine Fassung', 'base_version' => 2]));

    expect([$refused->status, $refused->reason, $refused->detail])->toBe([409, 'page_conflict', __('problem.detail.page_conflict', ['name' => 'Mara'])])
        ->and($refused->extensions['current']['version'])->toBe(3)
        ->and($refused->extensions['current']['content'])->toBe('Erste Fassung')
        ->and($refused->extensions['current']['content_json'])->toBe($before?->content)
        ->and($w['page']->fresh()?->toArray())->toBe($before?->toArray())
        ->and(PageVersion::query()->count())->toBe(0)
        ->and(eventsOf(EventType::PageUpdated))->toHaveCount(0);
});

it('keeps the foreign version before overwriting it, also without a base version', function () use ($world, $save) {
    $w = $world();
    $w['page']->forceFill(['updated_at' => now()->subMinute()])->save();
    $stored = $w['page']->fresh();

    $saved = $save($w['jonas'], $w['page'], ['content' => 'Fassung von Jonas']);

    $kept = PageVersion::query()->sole();
    expect([$kept->page_id, $kept->version, $kept->title, $kept->content, $kept->author_id])
        ->toBe([$w['page']->id, 1, 'Ablauf', $stored?->content, $w['mara']->id])
        ->and($kept->created_at?->toJSON())->toBe($stored?->updated_at?->toJSON())
        ->and($saved->version)->toBe(2)
        ->and($saved->updated_by)->toBe($w['jonas']->id)
        ->and(eventsOf(EventType::PageUpdated, $w['page'])->sole()->meta)->toMatchArray(['kept_version' => 1]);
});

it('keeps the state after a pause of ten minutes', function () use ($world, $save) {
    $w = $world();
    $first = $save($w['mara'], $w['page'], ['content' => 'Am Morgen']);

    $this->travel(10)->minutes();
    $save($w['mara'], $first, ['content' => 'Nach der Pause']);

    expect(PageVersion::query()->sole()->only('version', 'content'))->toBe(['version' => 2, 'content' => F::doc(F::p('Am Morgen'))])
        ->and($w['page']->fresh()?->version)->toBe(3);
});

it('keeps the own state when asked', function () use ($world, $save) {
    $w = $world();

    $saved = $save($w['mara'], $w['page'], ['content' => 'Meine Fassung', 'keep_current' => true, 'base_version' => 1]);

    expect(PageVersion::query()->sole()->version)->toBe(1)
        ->and($saved->version)->toBe(2)
        ->and(eventsOf(EventType::PageUpdated, $w['page'])->sole()->meta)->toMatchArray(['kept_version' => 1]);
});

it('keeps nothing for the same writer within the pause', function () use ($world, $save) {
    $w = $world();
    $first = $save($w['mara'], $w['page'], ['content' => 'Am Morgen', 'keep_current' => false]);

    $this->travel(599)->seconds();
    $second = $save($w['mara'], $first, ['content' => 'Kurz danach', 'keep_current' => null]);

    expect(PageVersion::query()->count())->toBe(0)
        ->and($second->version)->toBe(3)
        ->and(eventsOf(EventType::PageUpdated, $w['page'])->every(fn ($event) => ! array_key_exists('kept_version', $event->meta ?? [])))->toBeTrue();
});

it('writes nothing and no event for an unchanged page, also on an outdated base', function () use ($world, $save) {
    $w = $world();
    $w['page']->forceFill(['version' => 4, 'updated_at' => now()->subHour()])->save();
    $before = $w['page']->fresh();

    $same = $save($w['jonas'], $w['page'], ['title' => 'Ablauf', 'emoji' => '🚀', 'content_json' => $before?->content, 'base_version' => 2, 'keep_current' => true]);
    $nothing = $save($w['jonas'], $w['page'], []);

    expect($same->version)->toBe(4)
        ->and($same->updated_by)->toBe($w['mara']->id)
        ->and($same->lean)->toBeFalse()
        ->and($nothing->version)->toBe(4)
        ->and($w['page']->fresh()?->updated_at?->toJSON())->toBe($before?->updated_at?->toJSON())
        ->and(PageVersion::query()->count())->toBe(0)
        ->and(eventsOf(EventType::PageUpdated))->toHaveCount(0);
});

it('writes the title, emoji and version into the event, never the text', function () use ($world, $save) {
    $w = $world();

    $save($w['mara'], $w['page'], ['title' => 'Neuer Titel', 'emoji' => null, 'content' => 'Geheimer Text']);
    $save($w['mara'], $w['page'], ['content' => 'Noch geheimer']);
    $save($w['mara'], $w['page'], ['emoji' => '📘']);

    [$first, $second, $third] = eventsOf(EventType::PageUpdated, $w['page'])->all();
    expect($first->changes)->toBe(['title' => ['old' => 'Ablauf', 'new' => 'Neuer Titel'], 'emoji' => ['old' => '🚀', 'new' => null], 'version' => ['old' => 1, 'new' => 2]])
        ->and($second->changes)->toBe(['version' => ['old' => 2, 'new' => 3]])
        ->and($third->changes)->toBe(['emoji' => ['old' => null, 'new' => '📘'], 'version' => ['old' => 3, 'new' => 4]])
        ->and($first->actor_id)->toBe($w['mara']->id)
        ->and($first->project_id)->toBe($w['web']->id)
        ->and(json_encode([$first->changes, $first->meta, $second->changes, $second->meta]))->not->toContain('geheim')
        ->and($first->meta)->not->toHaveKey('kept_version');
});

it('keeps references and mentions the writer may no longer use when they stood in the page before', function () use ($world, $save) {
    $w = $world();
    $hidden = WorkItem::factory()->for(Project::factory()->private()->create())->create();
    $kira = memberOf($w['web'], ProjectRole::Member, ['name' => 'Kira', 'handle' => 'kira']);
    $json = F::doc(F::p(F::mention($kira->id, 'kira'), ' siehe ', F::reference($hidden->id)));
    $w['page']->update(['content' => $json]);
    app(RoleAssignments::class)->removeFromProject($kira, $w['web']);

    $saved = $save($w['jonas'], $w['page'], ['content_json' => F::doc(F::p(F::mention($kira->id, 'kira'), ' siehe ', F::reference($hidden->id), ' und mehr'))]);
    $fresh = $save($w['jonas'], Page::factory()->create(['project_id' => $w['web']->id]), ['content_json' => $json]);

    expect($saved->content)->toBe(F::doc(F::p(F::mention($kira->id, 'kira'), ' siehe ', F::reference($hidden->id), ' und mehr')))
        // a page that never named them takes neither
        ->and($fresh->content)->toBe(F::doc(F::p('@kira siehe ')));
});

it('refuses wrong fields in one 422 and leaves the page as it is', function () use ($world, $save) {
    $w = $world();

    expect(invalidOf(fn () => $save($w['mara'], $w['page'], ['title' => '', 'emoji' => '🚀🚀', 'content' => '![x](attachment:01jzzzzzzzzzzzzzzzzzzzzzzz)', 'base_version' => 0, 'keep_current' => 'ja'])))->toBe([
        'title' => [__('field.title.required')],
        'emoji' => [__('field.emoji.invalid')],
        'content' => [__('field.rich_text.attachment')],
        'base_version' => [__('field.base_version.invalid')],
        'keep_current' => [__('field.boolean')],
    ])
        ->and(invalidOf(fn () => $save($w['mara'], $w['page'], ['title' => str_repeat('a', 201), 'base_version' => '2'])))->toBe([
            'title' => [__('field.title.max', ['max' => 200])],
            'base_version' => [__('field.base_version.invalid')],
        ])
        ->and($w['page']->fresh()?->version)->toBe(1)
        ->and(eventsOf(EventType::PageUpdated))->toHaveCount(0);
});

it('refuses a viewer with wiki_members_only, hides a private page, and refuses an archived project and a page gone meanwhile', function () use ($world, $save) {
    $w = $world();
    $private = Page::factory()->create(['project_id' => Project::factory()->private()->create()->id]);
    $gone = Page::factory()->create(['project_id' => $w['web']->id]);
    $stale = Page::query()->findOrFail($gone->id);
    $gone->delete();

    $viewer = problemOf(fn () => $save($w['lene'], $w['page'], ['title' => 'Neu']));
    $hidden = problemOf(fn () => $save($w['jonas'], $private, ['title' => 'Neu']));
    $deleted = problemOf(fn () => $save($w['jonas'], $stale, ['title' => 'Neu']));
    $w['web']->update(['archived_at' => now()]);
    $archived = problemOf(fn () => $save($w['mara'], $w['page'], ['title' => 'Neu']));

    expect([$viewer->status, $viewer->detail])->toBe([403, __('problem.detail.wiki_members_only')])
        ->and($hidden->status)->toBe(404)
        ->and($deleted->status)->toBe(404)
        ->and([$archived->status, $archived->reason])->toBe([409, 'project_archived'])
        ->and($w['page']->fresh()?->title)->toBe('Ablauf');
});

it('links new uploads of the writer to the page', function () use ($world, $save) {
    $w = $world();
    $upload = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['jonas']->id]);

    $save($w['jonas'], $w['page'], ['content_json' => F::doc(F::p('Mit Bild:'), F::image($upload->id, 'Skizze'))]);

    expect($upload->fresh()?->only('attachable_type', 'attachable_id'))->toBe(['attachable_type' => 'page', 'attachable_id' => $w['page']->id]);
});
