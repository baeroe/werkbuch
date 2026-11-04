<?php

use App\Access\ProjectRole;
use App\Actions\RichText\ResolveReferences;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/** Ida is a member of the public WEB; OPS is private and Ida is not in it. */
$world = function (): array {
    $ida = User::factory()->create(['name' => 'Ida Holm']);
    $web = Project::factory()->identifier('WEB')->public()->member($ida, ProjectRole::Member)->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();

    return [$ida, $web, $ops];
};

$resolve = fn (User $reader, array $query): Collection => ResolveReferences::run(actor($reader), $query)['items'];
/** The keys of the models in their order. */
$ids = fn (Collection $models): array => array_values($models->map(fn (WorkItem|Page $model) => $model->id)->all());

it('names the items the reader sees and leaves the others out', function () use ($world, $resolve, $ids) {
    [$ida, $web, $ops] = $world();
    $inWeb = WorkItem::factory()->for($web)->create();
    $inOps = WorkItem::factory()->for($ops)->create();
    $deleting = Project::factory()->public()->member($ida, ProjectRole::Member)->create(['deleting_at' => now()]);
    $inDeleting = WorkItem::factory()->for($deleting)->create();
    $unknown = strtolower((string) Str::ulid());

    $items = $resolve($ida, ['items' => implode(',', [$inOps->id, $inWeb->id, $unknown, $inDeleting->id])]);

    expect($ids($items))->toBe([$inWeb->id])
        ->and($items->first()->lean)->toBeTrue()
        ->and($items->first()->relationLoaded('labels'))->toBeTrue();
});

it('keeps the order asked for', function () use ($world, $resolve, $ids) {
    [$ida, $web] = $world();
    [$first, $second, $third] = WorkItem::factory()->for($web)->count(3)->create()->all();

    expect($ids($resolve($ida, ['items' => [$third->id, strtoupper($first->id), $second->id, $third->id]])))->toBe([$third->id, $first->id, $second->id])
        ->and($ids($resolve($ida, ['items' => " {$second->id} , ,{$first->id}"])))->toBe([$second->id, $first->id])
        // Unicode spaces around an id go like any other (T11-M3)
        ->and($ids($resolve($ida, ['items' => "\u{00A0}{$second->id}\u{00A0},\u{2003}{$first->id}"])))->toBe([$second->id, $first->id]);
});

it('names a child item like any other (T11-M4)', function () use ($world, $resolve, $ids) {
    [$ida, $web] = $world();
    $epic = WorkItem::factory()->for($web)->epic()->create();
    $child = WorkItem::factory()->for($web)->childOf($epic)->create();

    expect($ids($resolve($ida, ['items' => [$child->id, $epic->id]])))->toBe([$child->id, $epic->id]);
});

it('includes archived items', function () use ($world, $resolve, $ids) {
    [$ida, $web] = $world();
    $archived = WorkItem::factory()->for($web)->archived()->create();
    $archivedProject = Project::factory()->archived()->member($ida, ProjectRole::Member)->create();
    $inArchivedProject = WorkItem::factory()->for($archivedProject)->create();

    expect($ids($resolve($ida, ['items' => [$archived->id, $inArchivedProject->id]])))->toBe([$archived->id, $inArchivedProject->id]);
});

it('refuses more than 100 ids', function () use ($world) {
    [$ida] = $world();
    $many = array_map(fn () => (string) Str::ulid(), range(1, 101));
    $message = ['items' => [__('field.items.invalid', ['max' => 100])]];

    expect(invalidOf(fn () => ResolveReferences::run(actor($ida), ['items' => $many])))->toBe($message)
        ->and(ResolveReferences::run(actor($ida), ['items' => [...array_slice($many, 0, 100), $many[0]]])['items'])->toBeEmpty();
});

it('refuses more than 100 ids over items and pages', function () use ($world) {
    [$ida] = $world();
    $many = array_map(fn () => strtolower((string) Str::ulid()), range(1, 101));
    $items = ['items' => [__('field.items.invalid', ['max' => 100])]];
    $pages = ['pages' => [__('field.pages.invalid', ['max' => 100])]];
    $resolved = ResolveReferences::run(actor($ida), ['items' => array_slice($many, 0, 50), 'pages' => implode(',', array_slice($many, 50, 50))]);

    expect(invalidOf(fn () => ResolveReferences::run(actor($ida), ['items' => array_slice($many, 0, 60), 'pages' => array_slice($many, 60)])))->toBe($items + $pages)
        ->and(invalidOf(fn () => ResolveReferences::run(actor($ida), ['pages' => $many])))->toBe($pages)
        // the same ID asked as an item and as a page counts twice
        ->and(invalidOf(fn () => ResolveReferences::run(actor($ida), ['items' => [$many[0]], 'pages' => array_slice($many, 0, 100)])))->toBe($items + $pages)
        ->and($resolved['items'])->toBeEmpty()
        ->and($resolved['pages'])->toBeEmpty();
});

it('resolves pages the reader sees, in the order asked, and leaves out hidden ones without a count', function () use ($world, $ids) {
    [$ida, $web, $ops] = $world();
    [$first, $second] = Page::factory()->for($web)->count(2)->create()->all();
    $hidden = Page::factory()->for($ops)->create();
    $archived = Project::factory()->archived()->member($ida, ProjectRole::Member)->create();
    $inArchived = Page::factory()->for($archived)->create();
    $deleting = Project::factory()->public()->member($ida, ProjectRole::Member)->create(['deleting_at' => now()]);
    $inDeleting = Page::factory()->for($deleting)->create();
    $item = WorkItem::factory()->for($web)->create();

    $resolved = ResolveReferences::run(actor($ida), [
        'items' => [$item->id, $first->id],
        'pages' => implode(',', [$second->id, $hidden->id, strtoupper($first->id), $inDeleting->id, $item->id, $inArchived->id, $second->id]),
    ]);

    // an ID names an item only as an item, a page only as a page
    expect($ids($resolved['items']))->toBe([$item->id])
        ->and($ids($resolved['pages']))->toBe([$second->id, $first->id, $inArchived->id])
        ->and($resolved['pages']->every(fn (Page $page) => $page->lean))->toBeTrue()
        ->and(ResolveReferences::run(actor($ida), ['pages' => [$second->id]])['items'])->toBeEmpty();
});

it('reads the pages without their text (N2)', function () use ($world) {
    [$ida, $web] = $world();
    $page = Page::factory()->for($web)->withText('Der Ablauf am ersten Tag')->create();

    $read = ResolveReferences::run(actor($ida), ['pages' => [$page->id]])['pages']->sole();

    expect(array_keys($read->getAttributes()))->toEqualCanonicalizing(Page::LEAN_COLUMNS);
});

it('refuses a list of pages with what is no ULID', function () use ($world) {
    [$ida] = $world();
    $message = ['pages' => [__('field.pages.invalid', ['max' => 100])]];

    foreach ([['pages' => 'Handbuch'], ['pages' => [(string) Str::ulid(), 7]], ['pages' => 5], ['items' => (string) Str::ulid(), 'pages' => 'x']] as $query) {
        expect(invalidOf(fn () => ResolveReferences::run(actor($ida), $query)))->toBe($message);
    }
    // an empty list of pages with no items is the missing list
    expect(invalidOf(fn () => ResolveReferences::run(actor($ida), ['pages' => ' , '])))->toBe(['items' => [__('field.items.invalid', ['max' => 100])]]);
});

it('refuses a missing list, an empty one and what is no ULID', function () use ($world) {
    [$ida] = $world();
    $message = ['items' => [__('field.items.invalid', ['max' => 100])]];

    foreach ([[], ['items' => ''], ['items' => ' , '], ['items' => []], ['items' => 'WEB-1'], ['items' => [(string) Str::ulid(), 7]], ['items' => 5]] as $query) {
        expect(invalidOf(fn () => ResolveReferences::run(actor($ida), $query)))->toBe($message);
    }
});

it('answers over REST with a read token, lean', function () use ($world) {
    [$ida, $web, $ops] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $hidden = WorkItem::factory()->for($ops)->create();

    $response = $this->withToken(apiToken($ida, ['read']))->getJson("/api/v1/references?items={$hidden->id},{$item->id}")->assertOk();

    expect($response->json('data.items'))->toHaveCount(1)
        ->and($response->json('data.items.0.key'))->toBe($item->key)
        ->and($response->json('data.items.0'))->not->toHaveKey('description')
        ->and($response->json('data.pages'))->toBe([]);
});

it('answers pages over REST, lean', function () use ($world) {
    [$ida, $web, $ops] = $world();
    $page = Page::factory()->for($web)->create(['title' => 'Handbuch', 'emoji' => '📘']);
    $hidden = Page::factory()->for($ops)->create();

    $response = $this->withToken(apiToken($ida, ['read']))->getJson("/api/v1/references?pages={$hidden->id},{$page->id}")->assertOk();

    expect($response->json('data.items'))->toBe([])
        ->and($response->json('data.pages'))->toHaveCount(1)
        ->and($response->json('data.pages.0'))->toMatchArray(['id' => $page->id, 'project_id' => $web->id, 'title' => 'Handbuch', 'emoji' => '📘'])
        ->and($response->json('data.pages.0'))->not->toHaveKey('content')
        ->and($response->json('data.pages.0'))->not->toHaveKey('content_json');
});
