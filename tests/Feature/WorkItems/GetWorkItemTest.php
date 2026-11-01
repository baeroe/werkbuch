<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\GetWorkItem;
use App\Exceptions\Problem;
use App\Http\Resources\WorkItemResource;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Facades\DB;
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
        'name' => 'comments', 'allowed' => 'children, type, workflow, relations',
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

    foreach ([[], ['children', 'type', 'workflow']] as $include) {
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
        ->and($data['workflow']['states'])->not->toBeEmpty();
});
