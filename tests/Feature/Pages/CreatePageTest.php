<?php

use App\Access\ProjectRole;
use App\Actions\Pages\CreatePage;
use App\Events\EventType;
use App\Models\Attachment;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use Tests\Support\RichTextFixtures as F;

/*
 * Creating a page (Task 4): at the end of its siblings, in version 1, with `page.created`. WEB (public) with Mara as its
 * admin, Jonas as a member and Lene as a viewer.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $jonas = memberOf($web, ProjectRole::Member, ['name' => 'Jonas', 'handle' => 'jonas']);
    $lene = memberOf($web, ProjectRole::Viewer, ['name' => 'Lene', 'handle' => 'lene']);

    return compact('mara', 'web', 'jonas', 'lene');
};

$create = fn (User $user, Project|string $project, array $input): Page => CreatePage::run(actor($user), $project, $input);

it('creates a page at the end of its siblings', function () use ($world, $create) {
    $w = $world();
    $root = Page::factory()->create(['project_id' => $w['web']->id, 'title' => 'Start']);
    $first = Page::factory()->childOf($root)->create(['rank' => 'a5']);

    $page = $create($w['jonas'], 'web', ['title' => '  Ablauf  ', 'emoji' => '🚀', 'parent_id' => strtoupper($root->id), 'content' => 'Wie wir **arbeiten**']);
    $top = $create($w['jonas'], $w['web'], ['title' => 'Glossar']);

    expect($page->wasRecentlyCreated)->toBeTrue()
        ->and($page->title)->toBe('Ablauf')
        ->and($page->emoji)->toBe('🚀')
        ->and($page->parent_id)->toBe($root->id)
        ->and(strcmp($page->rank, $first->rank))->toBeGreaterThan(0)
        ->and($page->version)->toBe(1)
        ->and($page->content_text)->toBe('Wie wir arbeiten')
        ->and($page->created_by)->toBe($w['jonas']->id)
        ->and($page->updated_by)->toBe($w['jonas']->id)
        ->and($page->lean)->toBeFalse()
        ->and($top->parent_id)->toBeNull()
        ->and(strcmp($top->rank, $root->rank))->toBeGreaterThan(0)
        ->and($top->content)->toBeNull();

    $event = eventsOf(EventType::PageCreated, $page)->sole();
    expect($event->actor_id)->toBe($w['jonas']->id)
        ->and($event->project_id)->toBe($w['web']->id)
        ->and($event->changes)->toBe(['title' => ['old' => null, 'new' => 'Ablauf']]);
});

it('starts the first page of a wiki with the first rank', function () use ($world, $create) {
    $w = $world();

    expect($create($w['mara'], $w['web'], ['title' => 'Start'])->rank)->toBe('a0');
});

it('refuses an empty title, a title over 200 characters, a wrong emoji and a parent of another project in one 422', function () use ($world, $create) {
    $w = $world();
    $other = Page::factory()->create(['project_id' => Project::factory()->create()->id]);

    expect(invalidOf(fn () => $create($w['mara'], $w['web'], ['title' => ' ', 'emoji' => 'ab', 'parent_id' => $other->id, 'content_json' => ['type' => 'nope']])))->toBe([
        'title' => [__('field.title.required')],
        'emoji' => [__('field.emoji.invalid')],
        'content_json' => [__('field.rich_text.invalid')],
        // a page of another project is the same as an unknown one: the tree would lose the page (K8)
        'parent_id' => [__('field.parent_page.unknown')],
    ])
        ->and(invalidOf(fn () => $create($w['mara'], $w['web'], ['title' => str_repeat('a', 201), 'parent_id' => '01JUNKNOWNPAGE0000000000000'])))->toBe([
            'title' => [__('field.title.max', ['max' => 200])],
            'parent_id' => [__('field.parent_page.unknown')],
        ])
        ->and(invalidOf(fn () => $create($w['mara'], $w['web'], ['emoji' => 7, 'parent_id' => ['x']])))->toBe([
            'title' => [__('field.title.required')],
            'emoji' => [__('field.emoji.invalid')],
            'parent_id' => [__('field.parent_page.unknown')],
        ])
        ->and(Page::query()->where('project_id', $w['web']->id)->count())->toBe(0)
        ->and(eventsOf(EventType::PageCreated))->toHaveCount(0);
});

it('takes a title of exactly 200 characters and no emoji', function () use ($world, $create) {
    $w = $world();

    $page = $create($w['mara'], $w['web'], ['title' => str_repeat('ä', 200), 'emoji' => null, 'content' => '']);

    expect(mb_strlen($page->title))->toBe(200)->and($page->emoji)->toBeNull()->and($page->content)->toBeNull();
});

it('refuses a viewer with wiki_members_only and an archived project with project_archived', function () use ($world, $create) {
    $w = $world();
    $private = Project::factory()->private()->create();

    $viewer = problemOf(fn () => $create($w['lene'], $w['web'], ['title' => 'Neu']));
    $hidden = problemOf(fn () => $create($w['lene'], $private, ['title' => 'Neu']));
    $unknown = problemOf(fn () => $create($w['mara'], 'NOPE', ['title' => 'Neu']));
    $w['web']->update(['archived_at' => now()]);
    $archived = problemOf(fn () => $create($w['mara'], $w['web'], ['title' => 'Neu']));

    expect([$viewer->status, $viewer->detail])->toBe([403, __('problem.detail.wiki_members_only')])
        ->and($hidden->status)->toBe(404)
        ->and($unknown->status)->toBe(404)
        ->and([$archived->status, $archived->reason])->toBe([409, 'project_archived'])
        ->and(Page::query()->count())->toBe(0);
});

it('links the writer\'s own uploads of the project to the page and refuses an upload of another project', function () use ($world, $create) {
    $w = $world();
    $mine = Attachment::factory()->create(['project_id' => $w['web']->id, 'uploaded_by' => $w['jonas']->id]);
    $elsewhere = Attachment::factory()->create(['project_id' => Project::factory()->create()->id, 'uploaded_by' => $w['jonas']->id]);

    $page = $create($w['jonas'], $w['web'], ['title' => 'Skizzen', 'content_json' => F::doc(F::p('Hier:'), F::image($mine->id, 'Skizze'))]);

    expect($mine->fresh()?->attachable_type)->toBe('page')
        ->and($mine->fresh()?->attachable_id)->toBe($page->id)
        ->and(invalidOf(fn () => $create($w['jonas'], $w['web'], ['title' => 'Fremd', 'content' => "![Bild](attachment:{$elsewhere->id})"])))
        ->toBe(['content' => [__('field.rich_text.attachment')]])
        ->and($elsewhere->fresh()?->attachable_id)->toBeNull()
        ->and(Page::query()->where('title', 'Fremd')->exists())->toBeFalse();
});
