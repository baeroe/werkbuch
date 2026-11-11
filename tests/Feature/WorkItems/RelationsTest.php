<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Actions\Projects\ArchiveProject;
use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\GetWorkItem;
use App\Actions\WorkItems\ListRelations;
use App\Actions\WorkItems\RemoveRelation;
use App\Events\EventType;
use App\Http\Resources\RelationEntryResource;
use App\Http\Resources\WorkItemResource;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Support\Actor;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * WEB (public) with Mara as its admin and lead, OPS (private) with Mara as a member, and Ida, a member of WEB who does
 * not see OPS.
 */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    $ida = memberOf($web, ProjectRole::Member, ['name' => 'Ida']);

    return [$web, $ops, $mara, $ida];
};

$type = fn (string $builtIn): RelationType => RelationType::query()->where('built_in', $builtIn)->firstOrFail();

/** The field errors a call ended with. */
$errorsOf = function (Closure $call): array {
    try {
        $call();
    } catch (ValidationException $e) {
        return $e->errors();
    }

    throw new RuntimeException('The call did not fail validation.');
};

it('relates items across projects', function () use ($world, $type) {
    [$web, $ops, $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $other = WorkItem::factory()->for($ops)->create();
    $relates = $type('relates');

    // the target by its key in any case, the type as a capital ULID
    $relation = AddRelation::run(actor($mara), $item, ['type_id' => strtoupper($relates->id), 'target_id' => 'ops-1']);

    expect([$relation->type_id, $relation->source_id, $relation->target_id])->toBe([$relates->id, $item->id, $other->id])
        ->and(WorkItemRelation::query()->count())->toBe(1);

    $entries = ListRelations::run(actor($mara), $other);
    expect($entries)->toHaveCount(1)
        ->and($entries[0]['relation']->id)->toBe($relation->id)
        ->and($entries[0]['other']?->id)->toBe($item->id)
        ->and($entries[0]['direction'])->toBe('inward')
        ->and($entries[0]['hidden'])->toBeFalse();

    // and by its ULID, also in capitals
    $target = WorkItem::factory()->for($ops)->create();
    expect(AddRelation::run(actor($mara), $item, ['type_id' => $relates->id, 'target_id' => strtoupper($target->id)])->target_id)->toBe($target->id);
});

it('refuses an item with itself and the same pair twice', function () use ($world, $type, $errorsOf) {
    [$web, , $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $other = WorkItem::factory()->for($web)->create();
    $relates = $type('relates');

    expect($errorsOf(fn () => AddRelation::run(actor($mara), $item, ['type_id' => $relates->id, 'target_id' => $item->key])))
        ->toBe(['target_id' => [__('field.target_id.self')]]);

    AddRelation::run(actor($mara), $item, ['type_id' => $relates->id, 'target_id' => $other->id]);

    expect($errorsOf(fn () => AddRelation::run(actor($mara), $item, ['type_id' => $relates->id, 'target_id' => $other->key])))
        ->toBe(['target_id' => [__('field.target_id.duplicate')]])
        // another type between the same pair is another relation
        ->and(AddRelation::run(actor($mara), $item, ['type_id' => $type('duplicates')->id, 'target_id' => $other->id])->type_id)->toBe($type('duplicates')->id);

    // an unknown type, also one that is no ULID, a full-width look-alike or missing, and the item itself in one answer
    $lookalike = '０'.substr($relates->id, 1);
    foreach ([Str::ulid()->toBase32(), 'blocks', $lookalike, null, ['x']] as $typeId) {
        expect($errorsOf(fn () => AddRelation::run(actor($mara), $item, ['type_id' => $typeId, 'target_id' => $item->id])))->toBe([
            'type_id' => [__('field.type_id.unknown_relation')],
            'target_id' => [__('field.target_id.self')],
        ]);
    }

    expect(WorkItemRelation::query()->count())->toBe(2);
});

it('counts the other direction of a symmetric type as the same pair, but not of a directed one', function () use ($world, $type, $errorsOf) {
    [$web, , $mara] = $world();
    $a = WorkItem::factory()->for($web)->create();
    $b = WorkItem::factory()->for($web)->create();

    AddRelation::run(actor($mara), $a, ['type_id' => $type('relates')->id, 'target_id' => $b->id]);
    AddRelation::run(actor($mara), $a, ['type_id' => $type('blocks')->id, 'target_id' => $b->id]);

    expect($errorsOf(fn () => AddRelation::run(actor($mara), $b, ['type_id' => $type('relates')->id, 'target_id' => $a->id])))
        ->toBe(['target_id' => [__('field.target_id.duplicate')]])
        ->and(AddRelation::run(actor($mara), $b, ['type_id' => $type('blocks')->id, 'target_id' => $a->id])->source_id)->toBe($b->id)
        ->and(WorkItemRelation::query()->count())->toBe(3);
});

it('turns a pair the unique index refuses into the same field error', function () use ($world, $type, $errorsOf) {
    [$web, , $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $other = WorkItem::factory()->for($web)->create();
    $relates = $type('relates');

    // another request saves the same pair between the check and the insert (as only a race could)
    $raced = false;
    DB::connection()->beforeExecuting(function (string $query) use (&$raced, $relates, $item, $other): void {
        if (! $raced && str_starts_with($query, 'insert into `work_item_relations`')) {
            $raced = true;
            DB::table('work_item_relations')->insert([
                'id' => strtolower((string) Str::ulid()), 'type_id' => $relates->id, 'source_id' => $item->id, 'target_id' => $other->id,
            ]);
        }
    });

    // on one connection the raced row goes with the rollback as well: nothing stays, no event
    expect($errorsOf(fn () => AddRelation::run(actor($mara), $item, ['type_id' => $relates->id, 'target_id' => $other->id])))
        ->toBe(['target_id' => [__('field.target_id.duplicate')]])
        ->and($raced)->toBeTrue()
        ->and(WorkItemRelation::query()->count())->toBe(0)
        ->and(eventsOf(EventType::WorkItemRelationAdded))->toHaveCount(0);
});

it('blanks the hidden end', function () use ($world, $type) {
    [$web, $ops, $mara, $ida] = $world();
    $item = WorkItem::factory()->for($web)->create(['title' => 'Formular prüfen']);
    $secret = WorkItem::factory()->for($ops)->create(['title' => 'Geheime Migration']);
    $visible = WorkItem::factory()->for($web)->create(['title' => 'Sichtbar']);
    $blocks = $type('blocks');
    $outward = WorkItemRelation::factory()->create(['type_id' => $blocks->id, 'source_id' => $item->id, 'target_id' => $secret->id]);
    $inward = WorkItemRelation::factory()->create(['type_id' => $type('relates')->id, 'source_id' => $secret->id, 'target_id' => $item->id]);
    WorkItemRelation::factory()->create(['type_id' => $blocks->id, 'source_id' => $visible->id, 'target_id' => $item->id]);

    $entries = ListRelations::run(actor($ida), $item);
    $data = array_map(fn (array $entry) => (new RelationEntryResource($entry))->resolve(request()), $entries);

    // the type first, the hidden ones after the visible ones of their type
    expect(array_column($data, 'hidden'))->toBe([false, true, true])
        ->and($data[0]['other']['key'])->toBe('WEB-2')
        ->and($data[1])->toBe([
            'relation' => ['id' => $outward->id, 'type_id' => $blocks->id, 'source_id' => $item->id, 'target_id' => ''],
            'other' => null,
            'direction' => 'outward',
            'hidden' => true,
        ])
        ->and($data[2]['relation'])->toBe(['id' => $inward->id, 'type_id' => $type('relates')->id, 'source_id' => '', 'target_id' => $item->id])
        ->and($data[2]['direction'])->toBe('inward');

    // nothing of the hidden item anywhere, neither in …/relations nor in ?include=relations
    foreach (['/api/v1/work-items/WEB-1/relations', '/api/v1/work-items/WEB-1?include=relations'] as $url) {
        $this->actingAs($ida)->getJson($url)->assertOk()
            ->assertDontSee('OPS-1')->assertDontSee('Geheime Migration')->assertDontSee($secret->id)->assertSee('WEB-2');
    }

    // Mara sees OPS: nothing is hidden for her
    expect(array_column(ListRelations::run(actor($mara), $item), 'hidden'))->toBe([false, false, false]);
});

it('orders the relations by type, then by the key of the other end', function () use ($world, $type) {
    [$web, $ops, $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $others = WorkItem::factory()->for($web)->count(10)->create();
    $elsewhere = WorkItem::factory()->for($ops)->create();
    // WEB-11 and WEB-3 relate, WEB-4 blocks the item, the item blocks OPS-1 and WEB-10 (blocks comes before relates)
    foreach ([[$others[9], 'relates', true], [$elsewhere, 'blocks', true], [$others[1], 'relates', false], [$others[8], 'blocks', true], [$others[2], 'blocks', false]] as [$other, $builtIn, $outward]) {
        WorkItemRelation::factory()->create([
            'type_id' => $type($builtIn)->id,
            'source_id' => $outward ? $item->id : $other->id,
            'target_id' => $outward ? $other->id : $item->id,
        ]);
    }

    $keys = array_map(fn (array $entry) => $entry['other']?->key, ListRelations::run(actor($mara), $item));

    expect($keys)->toBe(['OPS-1', 'WEB-4', 'WEB-10', 'WEB-3', 'WEB-11']);
});

it('orders the identifiers of the other ends naturally (T21g-M2)', function () use ($world, $type) {
    [$web, , $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    // created A10 first, so neither the ULID nor the bytes put A2 first
    $a10 = WorkItem::factory()->for(Project::factory()->identifier('A10')->public()->create())->create();
    $a2 = WorkItem::factory()->for(Project::factory()->identifier('A2')->public()->create())->create();
    foreach ([$a10, $a2] as $other) {
        WorkItemRelation::factory()->create(['type_id' => $type('relates')->id, 'source_id' => $item->id, 'target_id' => $other->id]);
    }

    $keys = array_map(fn (array $entry) => $entry['other']?->key, ListRelations::run(actor($mara), $item));

    // like the sort by key and the parent groups: A2 before A10
    expect($keys)->toBe(['A2-1', 'A10-1']);
});

it('drops the leading zeros of a number in an identifier like the sort by key (A2-M1)', function () use ($world, $type) {
    [$web, , $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    // created A02 first, and the bytes put A02 first too: only a natural order without leading zeros puts A1 first
    $a02 = WorkItem::factory()->for(Project::factory()->identifier('A02')->public()->create())->create();
    $a1 = WorkItem::factory()->for(Project::factory()->identifier('A1')->public()->create())->create();
    foreach ([$a02, $a1] as $other) {
        WorkItemRelation::factory()->create(['type_id' => $type('relates')->id, 'source_id' => $item->id, 'target_id' => $other->id]);
    }

    $keys = array_map(fn (array $entry) => $entry['other']?->key, ListRelations::run(actor($mara), $item));
    $byKey = DB::table('projects')->whereIn('identifier', ['A02', 'A1'])->orderByRaw('natural_sort_key(identifier)')->pluck('identifier')->all();

    expect($byKey)->toBe(['A1', 'A02'])
        ->and($keys)->toBe(['A1-1', 'A02-1']);
});

it('does not tell whether a hidden target exists', function () use ($world, $type, $errorsOf) {
    [$web, $ops, , $ida] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $secret = WorkItem::factory()->for($ops)->create();
    $relates = $type('relates');

    foreach ([$secret->id, 'OPS-1', 'OPS-2', Str::ulid()->toBase32(), 'kein-key', '', null, 7] as $target) {
        expect($errorsOf(fn () => AddRelation::run(actor($ida), $item, ['type_id' => $relates->id, 'target_id' => $target])))
            ->toBe(['target_id' => [__('field.target_id.unknown')]]);
    }

    // a full-width look-alike of a visible item's ULID is no ULID
    $visible = WorkItem::factory()->for($web)->create();
    expect($errorsOf(fn () => AddRelation::run(actor($ida), $item, ['type_id' => $relates->id, 'target_id' => '０'.substr($visible->id, 1)])))
        ->toBe(['target_id' => [__('field.target_id.unknown')]])
        ->and(WorkItemRelation::query()->count())->toBe(0);
});

it('records the relation at both ends with the label of each side', function () use ($world, $type) {
    [$web, $ops, $mara] = $world();
    $item = WorkItem::factory()->for($web)->create(['updated_at' => '2026-10-01 08:00:00']);
    $other = WorkItem::factory()->for($ops)->create(['updated_at' => '2026-10-01 08:00:00']);
    $blocks = $type('blocks');
    Carbon::setTestNow('2026-11-02 09:30:00');

    $relation = AddRelation::run(actor($mara, Actor::VIA_API), $item, ['type_id' => $blocks->id, 'target_id' => $other->id]);

    $atSource = eventsOf(EventType::WorkItemRelationAdded, $item)->sole();
    $atTarget = eventsOf(EventType::WorkItemRelationAdded, $other)->sole();
    expect($atSource->changes)->toBe(['relation' => ['old' => null, 'new' => [
        'relation_type_id' => $blocks->id, 'direction' => 'outward', 'label' => __('catalog.builtin.relation.blocks.outward'), 'item_id' => $other->id,
    ]]])
        ->and($atTarget->changes)->toBe(['relation' => ['old' => null, 'new' => [
            'relation_type_id' => $blocks->id, 'direction' => 'inward', 'label' => __('catalog.builtin.relation.blocks.inward'), 'item_id' => $item->id,
        ]]])
        ->and([$atSource->project_id, $atTarget->project_id])->toBe([$web->id, $ops->id])
        ->and([$atSource->actor_id, $atTarget->actor_id])->toBe([$mara->id, $mara->id])
        ->and($atTarget->meta)->toMatchArray(['via' => Actor::VIA_API])
        ->and($item->fresh()?->updated_at?->toJSON())->toBe('2026-11-02T09:30:00.000000Z')
        ->and($other->fresh()?->updated_at?->toJSON())->toBe('2026-11-02T09:30:00.000000Z');

    Carbon::setTestNow('2026-11-03 10:00:00');
    RemoveRelation::run(actor($mara), $relation);

    $removedAtSource = eventsOf(EventType::WorkItemRelationRemoved, $item)->sole();
    $removedAtTarget = eventsOf(EventType::WorkItemRelationRemoved, $other)->sole();
    expect($removedAtSource->changes)->toBe(['relation' => ['old' => $atSource->changes['relation']['new'], 'new' => null]])
        ->and($removedAtTarget->changes)->toBe(['relation' => ['old' => $atTarget->changes['relation']['new'], 'new' => null]])
        ->and($removedAtTarget->project_id)->toBe($ops->id)
        ->and(WorkItemRelation::query()->count())->toBe(0)
        ->and($other->fresh()?->updated_at?->toJSON())->toBe('2026-11-03T10:00:00.000000Z');

    // a symmetric type reads the same from both ends
    $relates = AddRelation::run(actor($mara), $item, ['type_id' => $type('relates')->id, 'target_id' => $other->id]);
    expect(eventsOf(EventType::WorkItemRelationAdded, $other)->last()?->changes['relation']['new'])->toBe([
        'relation_type_id' => $relates->type_id, 'direction' => 'inward', 'label' => __('catalog.builtin.relation.relates.outward'), 'item_id' => $item->id,
    ]);
});

it('marks blocked and blocking items while both are open', function () use ($world, $type) {
    [$web, , $mara] = $world();
    $blocker = WorkItem::factory()->for($web)->create();
    $blocked = WorkItem::factory()->for($web)->create();
    $related = WorkItem::factory()->for($web)->create();
    AddRelation::run(actor($mara), $blocker, ['type_id' => $type('blocks')->id, 'target_id' => $blocked->id]);
    AddRelation::run(actor($mara), $blocker, ['type_id' => $type('relates')->id, 'target_id' => $related->id]);

    $flags = function (WorkItem $item) use ($mara): array {
        $data = (new WorkItemResource(GetWorkItem::run(actor($mara), $item->id)))->resolve(request());

        return [$data['blocked'], $data['blocking']];
    };

    expect($flags($blocker))->toBe([false, true])
        ->and($flags($blocked))->toBe([true, false])
        ->and($flags($related))->toBe([false, false]);

    $blocker->update(['state_id' => $web->workflow()->firstOrFail()->states()->where('name', 'Done')->value('id')]);

    expect($flags($blocker))->toBe([false, false])
        ->and($flags($blocked))->toBe([false, false]);
});

it('counts a hidden open blocker', function () use ($world, $type) {
    [$web, $ops, $mara, $ida] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $secret = WorkItem::factory()->for($ops)->create();
    AddRelation::run(actor($mara), $item, ['type_id' => $type('blocks')->id, 'target_id' => $secret->id]);
    WorkItemRelation::query()->firstOrFail()->update(['source_id' => $secret->id, 'target_id' => $item->id]);

    $this->actingAs($ida)->getJson('/api/v1/work-items/WEB-1?include=relations')->assertOk()
        ->assertJsonPath('data.blocked', true)
        ->assertJsonPath('data.relations.0.hidden', true)
        ->assertJsonPath('data.relations.0.relation.source_id', '');
});

it('embeds the relations of the reader and asks nothing in the resource', function () use ($world, $type) {
    [$web, $ops, $mara, $ida] = $world();
    $item = WorkItem::factory()->for($web)->create();
    WorkItemRelation::factory()->create(['type_id' => $type('blocks')->id, 'source_id' => $item->id, 'target_id' => WorkItem::factory()->for($ops)->create()->id]);
    WorkItemRelation::factory()->create(['source_id' => WorkItem::factory()->for($web)->create()->id, 'target_id' => $item->id]);

    foreach ([[$mara, ['OPS-1', 'WEB-2']], [$ida, [null, 'WEB-2']]] as [$reader, $keys]) {
        $loaded = GetWorkItem::run(actor($reader), $item->id, ['relations']);

        DB::enableQueryLog();
        $data = (new WorkItemResource($loaded))->resolve(request());
        expect(DB::getQueryLog())->toBe([]);
        DB::disableQueryLog();
        DB::flushQueryLog();

        // a visible end comes with everything the resource of an item has
        expect(array_map(fn (array $entry) => $entry['other']['key'] ?? null, $data['relations']))->toBe($keys)
            ->and(array_column($data['relations'], 'hidden'))->toBe(array_map(fn (?string $key) => $key === null, $keys))
            ->and(array_keys($data['relations'][1]['other']))->toBe(array_values(array_diff(array_keys($data), ['relations'])));
    }

    expect((new WorkItemResource(GetWorkItem::run(actor($mara), $item->id)))->resolve(request()))->not->toHaveKey('relations');
});

it('removes a relation from the end the actor may edit', function () use ($world, $type) {
    [$web, $ops, $mara, $ida] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $secret = WorkItem::factory()->for($ops)->create();
    // the source is the end Ida does not see: she acts through the target
    $hiddenSource = WorkItemRelation::factory()->create(['type_id' => $type('blocks')->id, 'source_id' => $secret->id, 'target_id' => $item->id]);

    RemoveRelation::run(actor($ida), $hiddenSource);

    expect(WorkItemRelation::query()->count())->toBe(0)
        ->and(eventsOf(EventType::WorkItemRelationRemoved, $secret)->sole()->actor_id)->toBe($ida->id);

    // as a viewer of OPS she sees the source but may not edit it: again the target
    app(RoleAssignments::class)->setProjectRole($ida, $ops, ProjectRole::Viewer);
    Visibility::forget();
    $visibleSource = WorkItemRelation::factory()->create(['type_id' => $type('relates')->id, 'source_id' => $secret->id, 'target_id' => $item->id]);

    $this->actingAs($ida)->deleteJson("/api/v1/relations/{$visibleSource->id}")->assertNoContent();
    expect(WorkItemRelation::query()->count())->toBe(0);

    // an outsider of both ends does not see the relation at all
    $both = WorkItemRelation::factory()->create(['source_id' => $secret->id, 'target_id' => WorkItem::factory()->for($ops)->create()->id]);
    $refused = problemOf(fn () => RemoveRelation::run(actor($ida), $both));
    expect([$refused->status, $refused->detail])->toBe([403, __('problem.detail.items_members_only')]);

    $outsider = User::factory()->create();
    expect(problemOf(fn () => RemoveRelation::run(actor($outsider), $both))->status)->toBe(404)
        ->and(WorkItemRelation::query()->count())->toBe(1);
});

it('removes a relation whose other end lies in a project being deleted, before the purge runs', function () use ($world, $type) {
    [$web, $ops, $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $doomed = WorkItem::factory()->for($ops)->create();
    $relation = WorkItemRelation::factory()->create(['type_id' => $type('relates')->id, 'source_id' => $item->id, 'target_id' => $doomed->id]);
    $ops->forceFill(['deleting_at' => now()])->save();
    Visibility::forget();

    RemoveRelation::run(actor($mara), $relation);

    expect(WorkItemRelation::query()->count())->toBe(0)
        ->and(eventsOf(EventType::WorkItemRelationRemoved, $item))->toHaveCount(1);
    // the end it acts through still needs a live project
    $relation = WorkItemRelation::factory()->create(['type_id' => $type('relates')->id, 'source_id' => $item->id, 'target_id' => WorkItem::factory()->for($web)->create()->id]);
    $web->forceFill(['deleting_at' => now()])->save();
    Visibility::forget();
    expect(problemOf(fn () => RemoveRelation::run(actor($mara), $relation))->status)->toBe(404);
});

it('answers 404 when the relation went in the meantime', function () use ($world) {
    [$web, , $mara] = $world();
    $relation = WorkItemRelation::factory()->create(['source_id' => WorkItem::factory()->for($web)->create()->id, 'target_id' => WorkItem::factory()->for($web)->create()->id]);
    $stale = WorkItemRelation::query()->findOrFail($relation->id);

    RemoveRelation::run(actor($mara), $relation);

    expect(problemOf(fn () => RemoveRelation::run(actor($mara), $stale))->status)->toBe(404)
        ->and(eventsOf(EventType::WorkItemRelationRemoved))->toHaveCount(2);
});

it('answers 403 to viewers', function () use ($world, $type) {
    [$web, , , $ida] = $world();
    $viewer = memberOf($web, ProjectRole::Viewer);
    $item = WorkItem::factory()->for($web)->create();
    $other = WorkItem::factory()->for($web)->create();

    $refused = problemOf(fn () => AddRelation::run(actor($viewer), $item, ['type_id' => $type('relates')->id, 'target_id' => $other->id]));
    expect([$refused->status, $refused->detail])->toBe([403, __('problem.detail.items_members_only')]);

    $relation = AddRelation::run(actor($ida), $item, ['type_id' => $type('relates')->id, 'target_id' => $other->id]);
    $refused = problemOf(fn () => RemoveRelation::run(actor($viewer), $relation));
    expect([$refused->status, $refused->detail])->toBe([403, __('problem.detail.items_members_only')])
        // reading is fine
        ->and(ListRelations::run(actor($viewer), $item))->toHaveCount(1);

    // what a viewer does not see is 404
    $ops = Project::factory()->private()->create();
    expect(problemOf(fn () => ListRelations::run(actor($viewer), WorkItem::factory()->for($ops)->create()))->status)->toBe(404);
});

it('keeps the relations of an archived project as they are', function () use ($world, $type) {
    [$web, $ops, $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $other = WorkItem::factory()->for($ops)->create();
    $relation = AddRelation::run(actor($mara), $item, ['type_id' => $type('relates')->id, 'target_id' => $other->id]);
    ArchiveProject::run(actor($mara), $web);

    foreach ([
        fn () => AddRelation::run(actor($mara), $item, ['type_id' => $type('blocks')->id, 'target_id' => $other->id]),
        // a member of WEB alone may edit only the end in the archived project
        fn () => RemoveRelation::run(actor(memberOf($web, ProjectRole::Member)), $relation),
    ] as $call) {
        $refused = problemOf($call);
        expect([$refused->status, $refused->reason])->toBe([409, 'project_archived']);
    }

    // Mara edits OPS as well: through that end it goes
    RemoveRelation::run(actor($mara), $relation);
    expect(WorkItemRelation::query()->count())->toBe(0);
});

it('keeps archived items read-only through relations, but lets them be the passive end', function () use ($world, $type) {
    [$web, $ops, $mara] = $world();
    $archived = WorkItem::factory()->for($web)->archived()->create(['updated_at' => '2026-10-01 08:00:00']);
    $active = WorkItem::factory()->for($ops)->create();
    $archivedOps = Project::factory()->identifier('OLD')->member($mara, ProjectRole::Member)->create(['lead_id' => $mara->id]);
    $inArchivedProject = WorkItem::factory()->for($archivedOps)->create();
    ArchiveProject::run(actor(User::factory()->admin()->create()), $archivedOps);
    Carbon::setTestNow('2026-11-02 09:30:00');

    // the archived item acts on nothing
    $refused = problemOf(fn () => AddRelation::run(actor($mara), $archived, ['type_id' => $type('relates')->id, 'target_id' => $active->id]));
    expect([$refused->status, $refused->reason, $refused->detail])->toBe([409, 'archived', __('problem.detail.item_archived', ['key' => 'WEB-1'])]);

    // as a target, an archived item and an item of an archived project are passive: they get their event and updated_at
    $relation = AddRelation::run(actor($mara), $active, ['type_id' => $type('relates')->id, 'target_id' => $archived->id]);
    AddRelation::run(actor($mara), $active, ['type_id' => $type('relates')->id, 'target_id' => $inArchivedProject->id]);
    expect(eventsOf(EventType::WorkItemRelationAdded, $archived))->toHaveCount(1)
        ->and(eventsOf(EventType::WorkItemRelationAdded, $inArchivedProject))->toHaveCount(1)
        ->and($archived->fresh()?->updated_at?->toJSON())->toBe('2026-11-02T09:30:00.000000Z');

    // a member of WEB alone may edit only the archived end
    $refused = problemOf(fn () => RemoveRelation::run(actor(memberOf($web, ProjectRole::Member)), $relation));
    expect([$refused->status, $refused->reason, $refused->detail])->toBe([409, 'archived', __('problem.detail.item_archived', ['key' => 'WEB-1'])]);

    // Mara edits OPS as well: through the active end it goes, the archived one is passive
    RemoveRelation::run(actor($mara), $relation);
    expect(WorkItemRelation::query()->whereKey($relation->id)->exists())->toBeFalse()
        ->and(eventsOf(EventType::WorkItemRelationRemoved, $archived))->toHaveCount(1);
});

it('answers 404 when an end went in the meantime', function () use ($world) {
    [$web, , $mara] = $world();
    $source = WorkItem::factory()->for($web)->create();
    $relation = WorkItemRelation::factory()->create(['source_id' => $source->id, 'target_id' => WorkItem::factory()->for($web)->create()->id]);
    // bound before the end went, its ends never loaded
    $stale = WorkItemRelation::query()->findOrFail($relation->id);
    $source->delete();

    expect(problemOf(fn () => RemoveRelation::run(actor($mara), $stale))->status)->toBe(404)
        ->and(eventsOf(EventType::WorkItemRelationRemoved))->toHaveCount(0);
});

it('answers 404 for an item that went in the meantime', function () use ($world, $type) {
    [$web, , $mara] = $world();
    $item = WorkItem::factory()->for($web)->create();
    $target = WorkItem::factory()->for($web)->create();
    $stale = WorkItem::query()->findOrFail($item->id);
    $item->delete();

    expect(problemOf(fn () => AddRelation::run(actor($mara), $stale, ['type_id' => $type('relates')->id, 'target_id' => $target->id]))->status)->toBe(404);
});
