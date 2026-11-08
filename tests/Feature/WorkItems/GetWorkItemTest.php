<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\GetWorkItem;
use App\Domain\Ranking\Rank;
use App\Exceptions\Problem;
use App\Http\Resources\WorkItemResource;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Factories\Sequence;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/** WEB (public) with Mara as its member and the former identifier OLD, and the private OPS she is no member of. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Member)->create();
    $web->identifiers()->create(['identifier' => 'OLD']);
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $ops->identifiers()->create(['identifier' => 'SEC']);

    return [$web, $ops, $mara];
};

it('finds an item by key, id and former key', function () use ($world) {
    [$web, , $mara] = $world();
    WorkItem::factory()->for($web)->create();
    $item = WorkItem::factory()->for($web)->create();

    foreach (['WEB-2', 'web-2', $item->id, strtoupper($item->id), 'OLD-2', 'old-2'] as $ref) {
        $found = GetWorkItem::run(actor($mara), $ref);
        expect($found->id)->toBe($item->id, $ref)
            ->and($found->resolved_by_former_identifier)->toBe(str_starts_with(strtoupper($ref), 'OLD'), $ref);
    }
    expect(GetWorkItem::run(actor($mara), $item)->id)->toBe($item->id);
});

it('answers 404 for an item the account does not see', function () use ($world) {
    [$web, $ops, $mara] = $world();
    $hidden = WorkItem::factory()->for($ops)->create();
    WorkItem::factory()->for($web)->create();

    foreach ([$hidden, $hidden->id, 'OPS-1', 'SEC-1', 'WEB-2', 'NOPE-1', 'kein-key'] as $ref) {
        expect(fn () => GetWorkItem::run(actor($mara), $ref))->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404));
    }

    // a project being deleted: nobody, not even an org admin
    $web->update(['deleting_at' => now()]);
    expect(fn () => GetWorkItem::run(actor(User::factory()->admin()->create()), 'WEB-1'))
        ->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404));
});

it('checks what to include only for an item the account sees', function () use ($world) {
    [$web, $ops, $mara] = $world();
    WorkItem::factory()->for($ops)->create();
    WorkItem::factory()->for($web)->create();

    expect(fn () => GetWorkItem::run(actor($mara), 'OPS-1', ['comments']))->toThrow(fn (Problem $problem) => expect($problem->status)->toBe(404));
    foreach ([[' comments'], ['children', 'type ', 'Workflow'], [['children']], [7]] as $include) {
        expect(fn () => GetWorkItem::run(actor($mara), 'WEB-1', $include))
            ->toThrow(fn (ValidationException $e) => expect(array_keys($e->errors()))->toBe(['include']));
    }
    expect(fn () => GetWorkItem::run(actor($mara), 'WEB-1', ['comments']))->toThrow(ValidationException::class, __('field.include.unknown', [
        'name' => 'comments', 'allowed' => 'children, type, workflow, relations, attachments',
    ]));

    // blanks around a name and empty names do not matter, the order of INCLUDES does
    expect(GetWorkItem::run(actor($mara), 'WEB-1', [' workflow', '', 'children', 'children'])->includes)->toBe(['children', 'workflow'])
        ->and(GetWorkItem::run(actor($mara), 'WEB-1')->includes)->toBe([]);
});

it('loads what the resource needs', function () use ($world) {
    [$web, , $mara] = $world();
    $epic = WorkItem::factory()->for($web)->epic()->create(['title' => 'Relaunch']);
    WorkItem::factory()->for($web)->childOf($epic)->closed()->create(['rank' => 'a8']);
    $first = WorkItem::factory()->for($web)->childOf($epic)->create(['rank' => 'a5']);
    $first->subscriptions()->create(['user_id' => $mara->id, 'reason' => 'manual']);
    Storage::fake('local');
    $file = Attachment::factory()->forItem($epic, 'file')->stored('Angebot', 'text/plain', 'angebot.txt')->create();

    foreach ([[], ['children', 'type', 'workflow', 'attachments']] as $include) {
        $item = GetWorkItem::run(actor($mara), 'OLD-1', $include);

        DB::enableQueryLog();
        $data = json_decode((string) json_encode(new WorkItemResource($item)), true);
        expect(DB::getQueryLog())->toBe([]);
        DB::disableQueryLog();
        DB::flushQueryLog();
    }

    expect($data['children_progress'])->toBe(['done' => 1, 'total' => 2])
        ->and(array_column($data['children'], 'key'))->toBe(['WEB-3', 'WEB-2'])
        ->and(array_column($data['children'], 'subscribed'))->toBe([true, false])
        ->and($data['children'][0]['parent'])->toBe(['id' => $epic->id, 'key' => 'WEB-1', 'title' => 'Relaunch', 'type_id' => $epic->type_id])
        ->and($data['children'][0])->not->toHaveKey('children')
        ->and($data['type']['id'])->toBe($epic->type_id)
        ->and($data['type']['is_epic'])->toBeTrue()
        ->and($data['workflow']['id'])->toBe($web->workflow_id)
        ->and($data['workflow']['states'])->not->toBeEmpty()
        ->and(array_column($data['attachments'], 'id'))->toBe([$file->id])
        ->and($data['attachments'][0]['url'])->toBe("/attachments/{$file->id}");
});

it('embeds at most 100 children in manual order', function () use ($world) {
    [$web, , $mara] = $world();
    $epic = WorkItem::factory()->for($web)->epic()->create();
    // the ranks of the 130 children in an order other than the one they were made in; one archived child among them
    $ranks = Rank::nBetween(null, null, 130);
    $children = WorkItem::factory()->for($web)->childOf($epic)->count(130)
        ->sequence(fn (Sequence $sequence) => ['rank' => $ranks[($sequence->index * 37) % 130]])->create();
    $archived = $children->sortBy('rank', SORT_STRING)->values()->get(3);
    $archived->update(['archived_at' => now()]);
    $expected = $children->sortBy(fn (WorkItem $child) => $child->rank, SORT_STRING)->take(100)->pluck('key')->all();

    // the same number of queries for 130 children as for 3 (a fresh model each: nothing loaded before counts)
    $queries = function (WorkItem $item) use ($mara): int {
        $item = $item->fresh();
        DB::flushQueryLog();
        DB::enableQueryLog();
        GetWorkItem::run(actor($mara), $item, ['children']);
        DB::disableQueryLog();

        return count(DB::getQueryLog());
    };
    $small = WorkItem::factory()->for($web)->epic()->create();
    WorkItem::factory()->for($web)->childOf($small)->count(3)->create();

    $item = GetWorkItem::run(actor($mara), $epic, ['children']);
    $data = json_decode((string) json_encode(new WorkItemResource($item)), true);

    expect($data['children'])->toHaveCount(100)
        ->and(array_column($data['children'], 'key'))->toBe($expected)
        ->and(array_column($data['children'], 'key'))->toContain($archived->key)
        ->and($data['children_progress'])->toBe(['done' => 0, 'total' => 130])
        ->and($queries($epic))->toBe($queries($small))
        ->and(GetWorkItem::CHILDREN_MAX)->toBe(100);
});
