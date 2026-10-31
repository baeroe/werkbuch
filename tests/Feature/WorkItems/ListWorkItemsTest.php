<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\ListWorkItems;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\ListResult;
use Illuminate\Validation\ValidationException;

/** WEB (public) with Mara as its member, and the private OPS she is no member of. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Member)->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();

    return [$web, $ops, $mara];
};

/**
 * The keys of a page, in its order.
 *
 * @param  ListResult<WorkItem>  $result
 * @return list<string>
 */
$keys = fn (ListResult $result): array => array_values(array_map(fn (WorkItem $item) => $item->key, $result->page->items()));

it('lists the items the account sees in manual order', function () use ($world, $keys) {
    [$web, $ops, $mara] = $world();
    WorkItem::factory()->for($web)->create(['rank' => 'a2']);
    WorkItem::factory()->for($web)->create(['rank' => 'a0']);
    // byte order: a capital letter comes before a small one (P4), a case-blind order would go by ULID
    WorkItem::factory()->for($web)->create(['rank' => 'az']);
    WorkItem::factory()->for($web)->create(['rank' => 'aZ']);
    WorkItem::factory()->for($ops)->create(['rank' => 'a0']);

    $result = ListWorkItems::run(actor($mara), []);

    expect($keys($result))->toBe(['WEB-2', 'WEB-1', 'WEB-4', 'WEB-3'])
        ->and($result->total)->toBe(4);
});

it('filters by project, by identifier and by a former one', function () use ($world, $keys) {
    [$web, , $mara] = $world();
    $app = Project::factory()->identifier('APP')->public()->create();
    $web->identifiers()->create(['identifier' => 'OLD']);
    WorkItem::factory()->for($web)->count(2)->create();
    WorkItem::factory()->for($app)->create();

    foreach ([$web->id, strtoupper($web->id), 'WEB', 'web', 'OLD'] as $ref) {
        expect($keys(ListWorkItems::run(actor($mara), ['filter' => ['project' => $ref]])))->toBe(['WEB-1', 'WEB-2'], $ref);
    }
    expect($keys(ListWorkItems::run(actor($mara), ['filter' => ['project' => 'APP']])))->toBe(['APP-1']);
});

it('answers 404 for a project the account does not see', function () use ($world) {
    [, $ops, $mara] = $world();
    WorkItem::factory()->for($ops)->create();

    foreach ([$ops->id, 'OPS', 'NOPE'] as $ref) {
        expect(fn () => ListWorkItems::run(actor($mara), ['filter' => ['project' => $ref]]))
            ->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404));
    }
});

it('hides archived items and the items of archived projects unless asked', function () use ($world, $keys) {
    [$web, , $mara] = $world();
    $old = Project::factory()->identifier('OLD')->public()->archived()->create();
    WorkItem::factory()->for($web)->create();
    WorkItem::factory()->for($web)->archived()->create();
    WorkItem::factory()->for($old)->create();

    expect($keys(ListWorkItems::run(actor($mara), [])))->toBe(['WEB-1'])
        ->and($keys(ListWorkItems::run(actor($mara), ['filter' => ['project' => 'OLD']])))->toBe([])
        ->and($keys(ListWorkItems::run(actor($mara), ['include_archived' => '1'])))->toEqualCanonicalizing(['WEB-1', 'WEB-2', 'OLD-1'])
        ->and(fn () => ListWorkItems::run(actor($mara), ['include_archived' => 'yes']))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toBe(['include_archived' => [__('field.include_archived.invalid')]]));
});

it('lists the children of an item', function () use ($world, $keys) {
    [$web, $ops, $mara] = $world();
    $web->identifiers()->create(['identifier' => 'OLD']);
    $epic = WorkItem::factory()->for($web)->epic()->create();
    WorkItem::factory()->for($web)->childOf($epic)->create(['rank' => 'a8']);
    WorkItem::factory()->for($web)->childOf($epic)->create(['rank' => 'a5']);
    WorkItem::factory()->for($web)->create();
    $hidden = WorkItem::factory()->for($ops)->epic()->create();

    foreach ([$epic->id, strtoupper($epic->id), 'WEB-1', 'web-1', 'OLD-1'] as $ref) {
        expect($keys(ListWorkItems::run(actor($mara), ['filter' => ['parent' => $ref]])))->toBe(['WEB-3', 'WEB-2'], $ref);
    }
    foreach ([$hidden->id, 'OPS-1', 'WEB-99'] as $ref) {
        expect(fn () => ListWorkItems::run(actor($mara), ['filter' => ['parent' => $ref]]))
            ->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404));
    }
});

it('finds by key or by part of the title, with % and _ taken literally', function () use ($world, $keys) {
    [$web, $ops, $mara] = $world();
    $web->identifiers()->create(['identifier' => 'OLD']);
    WorkItem::factory()->for($web)->create(['title' => '100% Abdeckung']);
    WorkItem::factory()->for($web)->create(['title' => '1000 Zeilen prüfen']);
    WorkItem::factory()->for($web)->create(['title' => 'snake_case umbenennen']);
    WorkItem::factory()->for($web)->create(['title' => 'snakeXcase lassen']);
    WorkItem::factory()->for($web)->create(['title' => 'Pfad C:\\temp']);
    WorkItem::factory()->for($web)->create(['title' => 'Nenne WEB-1 nicht']);
    WorkItem::factory()->for($ops)->create(['title' => 'Geheim']);
    $search = fn (string $q): array => $keys(ListWorkItems::run(actor($mara), ['filter' => ['q' => $q]]));

    expect($search('100%'))->toBe(['WEB-1'])
        ->and($search('e_c'))->toBe(['WEB-3'])
        ->and($search(':\\t'))->toBe(['WEB-5'])
        ->and($search('ABDECKUNG'))->toBe(['WEB-1'])
        ->and($search('  web-2 '))->toBe(['WEB-2'])
        ->and($search('OLD-3'))->toBe(['WEB-3'])
        // a key names exactly its item, never a title that holds it, and an item the account does not see is no match
        ->and($search('WEB-1'))->toBe(['WEB-1'])
        ->and($search('WEB-99'))->toBe([])
        ->and($search('OPS-1'))->toBe([])
        ->and($search('   '))->toHaveCount(6);
});

it('pages with a cursor and counts the total', function () use ($world, $keys) {
    [$web, , $mara] = $world();
    WorkItem::factory()->for($web)->count(5)->create();

    $first = ListWorkItems::run(actor($mara), ['per_page' => 2]);
    $second = ListWorkItems::run(actor($mara), ['per_page' => 2, 'cursor' => $first->page->nextCursor()?->encode()]);

    expect($keys($first))->toBe(['WEB-1', 'WEB-2'])
        ->and($keys($second))->toBe(['WEB-3', 'WEB-4'])
        ->and([$first->total, $second->total])->toBe([5, 5]);
});

it('never lists items of a project that is being deleted', function () use ($world, $keys) {
    [$web, , $mara] = $world();
    $admin = User::factory()->admin()->create();
    WorkItem::factory()->for($web)->create();
    $web->update(['deleting_at' => now()]);

    expect($keys(ListWorkItems::run(actor($mara), ['include_archived' => true])))->toBe([])
        ->and($keys(ListWorkItems::run(actor($admin), ['include_archived' => true])))->toBe([])
        ->and(fn () => ListWorkItems::run(actor($admin), ['filter' => ['project' => 'WEB']]))
        ->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404));
});

it('refuses a filter that is no object of texts', function () use ($world) {
    [, , $mara] = $world();

    foreach ([['filter' => 'WEB'], ['filter' => ['project' => ['WEB']]], ['filter' => ['q' => 5]]] as $input) {
        expect(fn () => ListWorkItems::run(actor($mara), $input))
            ->toThrow(fn (ValidationException $e) => expect(array_values($e->errors()))->toBe([[__('field.filter.invalid')]]));
    }
});

it('loads the page for the resource with the account as reader', function () use ($world) {
    [$web, , $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $item->subscriptions()->create(['user_id' => $mara->id, 'reason' => 'manual']);

    $listed = ListWorkItems::run(actor($mara), [])->page->items()[0];

    expect($listed->subscribed)->toBeTrue()
        ->and($listed->relationLoaded('values'))->toBeTrue()
        ->and($listed->children_total)->toBe(0);
});
