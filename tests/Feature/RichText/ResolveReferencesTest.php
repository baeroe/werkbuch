<?php

use App\Access\ProjectRole;
use App\Actions\RichText\ResolveReferences;
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

$resolve = fn (User $reader, array $query): Collection => ResolveReferences::run(actor($reader), $query);
/** The keys of the models in their order. */
$ids = fn (Collection $items): array => array_values($items->map(fn (WorkItem $item) => $item->id)->all());

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
        ->and(ResolveReferences::run(actor($ida), ['items' => [...array_slice($many, 0, 100), $many[0]]]))->toBeEmpty();
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
        ->and($response->json('data.items.0'))->not->toHaveKey('description');
});
