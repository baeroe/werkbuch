<?php

use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\Priority;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\PropertyOption;
use App\Models\Resolution;
use App\Models\User;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemLabel;
use App\Models\WorkItemRelation;
use App\Models\WorkItemSubscriber;
use App\Models\WorkItemType;
use App\Models\WorkItemValue;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

it('spells the key from the current identifier', function () {
    $project = Project::factory()->identifier('WEB')->create();
    $first = WorkItem::factory()->for($project)->create();
    $second = WorkItem::factory()->for($project)->create();

    expect($first->key)->toBe('WEB-1')
        ->and($second->key)->toBe('WEB-2')
        ->and($project->fresh()?->next_number)->toBe(2);

    $project->update(['identifier' => 'NEW']);

    expect($first->fresh()?->key)->toBe('NEW-1');
});

it('finds an item by ULID, by key and by a former key', function () {
    $project = Project::factory()->identifier('WEB')->create();
    $project->identifiers()->create(['identifier' => 'OLD']);
    $item = WorkItem::factory()->for($project)->create();

    $byUlid = WorkItem::findByReference(strtoupper($item->id));
    $byKey = WorkItem::findByReference('web-1');
    $byFormer = WorkItem::findByReference('OLD-1');

    expect($byUlid?->is($item))->toBeTrue()
        ->and($byUlid?->resolved_by_former_identifier)->toBeFalse()
        ->and($byKey?->is($item))->toBeTrue()
        ->and($byKey?->resolved_by_former_identifier)->toBeFalse()
        ->and($byKey?->relationLoaded('project'))->toBeTrue()
        ->and($byFormer?->is($item))->toBeTrue()
        ->and($byFormer?->resolved_by_former_identifier)->toBeTrue()
        ->and($byFormer?->key)->toBe('WEB-1');

    foreach (['WEB-0', 'WEB-4294967296', 'WEB-99', 'OLD-99', 'XYZ-1', 'WEB', (string) Str::ulid()] as $ref) {
        expect(WorkItem::findByReference($ref))->toBeNull($ref);
    }
});

it('orders ranks by bytes', function () {
    $project = Project::factory()->create();
    foreach (['a1', 'Zz', 'a0'] as $rank) {
        WorkItem::factory()->for($project)->create(['rank' => $rank]);
    }

    expect(WorkItem::query()->orderBy('rank')->pluck('rank')->all())->toBe(['Zz', 'a0', 'a1'])
        // the collation of every other text would put the capital last
        ->and(WorkItem::query()->orderByRaw('convert(`rank` using utf8mb4) collate utf8mb4_unicode_ci')->pluck('rank')->all())
        ->toBe(['a0', 'a1', 'Zz']);
});

it('ranks a new item after the last one of its project', function () {
    $project = Project::factory()->create();
    $first = WorkItem::factory()->for($project)->create();
    $second = WorkItem::factory()->for($project)->create();

    expect(strcmp($first->rank, $second->rank))->toBeLessThan(0)
        ->and(WorkItem::factory()->create()->number)->toBe(1);
});

it('gives the items of one batch rising ranks and numbers, per project', function () {
    [$web, $app] = Project::factory()->count(2)->create()->all();
    $rising = function (array $ranks) {
        for ($i = 1; $i < count($ranks); $i++) {
            expect(strcmp($ranks[$i - 1], $ranks[$i]))->toBeLessThan(0, implode(', ', $ranks));
        }
    };

    $first = WorkItem::factory()->for($web)->count(3)->create();
    $other = WorkItem::factory()->for($app)->count(2)->create();
    $second = WorkItem::factory()->for($web)->count(2)->create();

    $rising([...$first->pluck('rank')->all(), ...$second->pluck('rank')->all()]);
    $rising($other->pluck('rank')->all());

    expect($first->pluck('number')->all())->toBe([1, 2, 3])
        ->and($second->pluck('number')->all())->toBe([4, 5])
        ->and($other->pluck('number')->all())->toBe([1, 2])
        // the other project starts where an empty project starts
        ->and($other->first()?->rank)->toBe($first->first()?->rank);
});

it('counts closed children and open blockers', function () {
    $computed = fn (WorkItem $item) => WorkItem::query()->withComputed()->findOrFail($item->id);
    $state = fn (WorkItem $item, StateCategory $category) => $item->update([
        'state_id' => WorkflowState::query()->where('workflow_id', $item->project->workflow_id)->where('category', $category->value)->value('id'),
    ]);

    $epic = WorkItem::factory()->epic()->create();
    WorkItem::factory()->childOf($epic)->closed()->create();
    WorkItem::factory()->childOf($epic)->create();
    $open = WorkItem::factory()->for($epic->project)->create();

    expect($computed($epic)->children_total)->toBe(2)
        ->and($computed($epic)->children_done)->toBe(1)
        ->and($computed($open)->children_total)->toBe(0)
        ->and($computed($open)->children_done)->toBe(0)
        ->and($computed($epic)->title)->toBe($epic->title);

    WorkItem::factory()->childOf($epic)->inState('Cancelled')->create();

    expect($computed($epic)->children_total)->toBe(3)->and($computed($epic)->children_done)->toBe(2);

    // A blocks B; C relates to D, which never blocks
    $a = WorkItem::factory()->create();
    $b = WorkItem::factory()->for($a->project)->create();
    WorkItemRelation::factory()->blocks()->create(['source_id' => $a->id, 'target_id' => $b->id]);
    $c = WorkItem::factory()->create();
    $d = WorkItem::factory()->for($c->project)->create();
    WorkItemRelation::factory()->create(['source_id' => $c->id, 'target_id' => $d->id]);

    $flags = fn (WorkItem $item) => [$computed($item)->is_blocked, $computed($item)->is_blocking];

    expect($flags($a))->toBe([false, true])
        ->and($flags($b))->toBe([true, false])
        ->and($flags($c))->toBe([false, false])
        ->and($flags($d))->toBe([false, false]);

    // a closed end blocks nothing, on either side
    $state($b, StateCategory::Completed);
    expect($flags($a))->toBe([false, false])->and($flags($b))->toBe([false, false]);

    $state($b, StateCategory::Started);
    $state($a, StateCategory::Canceled);
    expect($flags($a))->toBe([false, false])->and($flags($b))->toBe([false, false]);
});

it('removes values, labels, relations and subscriptions with the item and keeps its children', function () {
    $item = WorkItem::factory()->create();
    $other = WorkItem::factory()->for($item->project)->create();
    $child = WorkItem::factory()->childOf($item)->create();
    $property = Property::factory()->create();
    $item->values()->create(['property_id' => $property->id, 'position' => 0, 'value_string' => 'Text']);
    $item->labels()->attach(Label::factory()->create()->id);
    WorkItemRelation::factory()->create(['source_id' => $item->id, 'target_id' => $other->id]);
    WorkItemRelation::factory()->blocks()->create(['source_id' => $other->id, 'target_id' => $item->id]);
    $item->subscriptions()->create(['user_id' => User::factory()->create()->id, 'reason' => 'manual']);

    $item->delete();

    expect(WorkItemValue::query()->count())->toBe(0)
        ->and(WorkItemLabel::query()->count())->toBe(0)
        ->and(WorkItemRelation::query()->count())->toBe(0)
        ->and(WorkItemSubscriber::query()->count())->toBe(0)
        ->and(Label::query()->count())->toBe(1)
        ->and($child->fresh()?->parent_id)->toBeNull()
        ->and($other->fresh())->not->toBeNull();
});

it('removes the items with their project row', function () {
    $item = WorkItem::factory()->create();
    WorkItem::factory()->childOf($item)->create();
    WorkItemRelation::factory()->create(['source_id' => $item->id, 'target_id' => WorkItem::factory()->for($item->project)->create()->id]);
    $item->values()->create(['property_id' => Property::factory()->create()->id, 'position' => 0, 'value_bool' => true]);

    $item->project->delete();

    expect(WorkItem::query()->count())->toBe(0)
        ->and(WorkItemRelation::query()->count())->toBe(0)
        ->and(WorkItemValue::query()->count())->toBe(0);
});

it('removes the values of an option with the option and with its property', function () {
    $item = WorkItem::factory()->create();
    $property = Property::factory()->dropdown(['A', 'B'], true)->create();
    [$a, $b] = $property->options()->orderBy('position')->get()->all();
    $item->values()->create(['property_id' => $property->id, 'position' => 0, 'value_option_id' => $a->id]);
    $item->values()->create(['property_id' => $property->id, 'position' => 1, 'value_option_id' => $b->id]);

    $a->delete();

    expect($item->values()->pluck('value_option_id')->all())->toBe([$b->id]);

    $property->delete();

    expect(WorkItemValue::query()->count())->toBe(0)->and(PropertyOption::query()->count())->toBe(0);
});

it('keeps the rows of an item with their types and relations', function () {
    $mara = User::factory()->create();
    $parent = WorkItem::factory()->create();
    $item = WorkItem::factory()->childOf($parent)->closed()->create([
        'assignee_id' => $mara->id,
        'priority' => Priority::High,
        'description' => ['type' => 'doc', 'content' => []],
        'start_date' => '2026-10-01',
        'due_date' => '2026-10-31',
        'started_at' => now(),
    ])->fresh();
    assert($item instanceof WorkItem);
    $second = WorkItem::factory()->childOf($parent)->create();
    $text = Property::factory()->create();
    $number = Property::factory()->create();
    $values = [
        $item->values()->create(['property_id' => $number->id, 'position' => 0, 'value_number' => 2.5, 'value_date' => '2026-10-31', 'value_json' => ['type' => 'doc']]),
        $item->values()->create(['property_id' => $text->id, 'position' => 1, 'value_user_id' => $mara->id]),
        $item->values()->create(['property_id' => $text->id, 'position' => 0, 'value_bool' => false]),
    ];
    $labels = [Label::factory()->create(), Label::factory()->create()];
    $item->labels()->attach([$labels[1]->id, $labels[0]->id]);
    $out = WorkItemRelation::factory()->create(['source_id' => $item->id, 'target_id' => $second->id]);
    $in = WorkItemRelation::factory()->create(['source_id' => $second->id, 'target_id' => $item->id]);
    $subscription = $item->subscriptions()->create(['user_id' => $mara->id, 'reason' => 'manual', 'unsubscribed_at' => now()]);

    $orderedValues = collect($values)->sortBy(fn (WorkItemValue $value) => [$value->property_id, $value->position])->pluck('id')->all();

    expect($item->project->is($parent->project))->toBeTrue()
        ->and($item->project->workItems()->count())->toBe(3)
        ->and($item->type)->toBeInstanceOf(WorkItemType::class)
        ->and($item->state?->category)->toBe(StateCategory::Completed)
        ->and($item->resolution?->is(Resolution::query()->where('default_for', 'completed')->sole()))->toBeTrue()
        ->and($item->assignee?->is($mara))->toBeTrue()
        ->and($item->creator)->toBeInstanceOf(User::class)
        ->and($item->parent?->is($parent))->toBeTrue()
        ->and($parent->children->pluck('id')->all())->toBe([$item->id, $second->id])
        ->and($item->labels->pluck('id')->all())->toBe(collect($labels)->pluck('id')->sort()->values()->all())
        ->and($item->labels->first()?->pivot)->toBeInstanceOf(WorkItemLabel::class)
        ->and(Str::isUlid((string) WorkItemLabel::query()->value('id')))->toBeTrue()
        ->and($item->values->pluck('id')->all())->toBe($orderedValues)
        ->and($item->outgoing->pluck('id')->all())->toBe([$out->id])
        ->and($item->incoming->pluck('id')->all())->toBe([$in->id])
        ->and($out->type?->built_in)->toBe('relates')
        ->and($out->source?->is($item))->toBeTrue()
        ->and($out->target?->is($second))->toBeTrue()
        ->and($item->subscriptions->pluck('id')->all())->toBe([$subscription->id])
        ->and($subscription->user?->is($mara))->toBeTrue()
        ->and($subscription->workItem?->is($item))->toBeTrue()
        ->and($subscription->fresh()?->unsubscribed_at)->not->toBeNull()
        ->and($item->number)->toBeInt()
        ->and($item->priority)->toBe(Priority::High)
        ->and($item->description)->toBe(['type' => 'doc', 'content' => []])
        ->and($item->description_version)->toBe(1)
        ->and($item->start_date?->toDateString())->toBe('2026-10-01')
        ->and($item->due_date?->toDateString())->toBe('2026-10-31')
        ->and($item->started_at)->not->toBeNull()
        ->and($item->closed_at)->not->toBeNull()
        ->and($item->archived_at)->toBeNull()
        ->and(WorkItem::factory()->archived()->create()->archived_at)->not->toBeNull();

    $stored = WorkItemValue::query()->findOrFail($values[0]->id);
    $person = WorkItemValue::query()->findOrFail($values[1]->id);
    $switch = WorkItemValue::query()->findOrFail($values[2]->id);

    expect($stored->value_number)->toBe(2.5)
        ->and($stored->value_date?->toDateString())->toBe('2026-10-31')
        ->and($stored->value_json)->toBe(['type' => 'doc'])
        ->and($stored->position)->toBe(0)
        ->and($stored->workItem?->is($item))->toBeTrue()
        ->and($stored->property?->is($number))->toBeTrue()
        ->and($person->value_user_id)->toBe($mara->id)
        ->and($switch->value_bool)->toBeFalse();
});

it('keeps only the items of the projects an account sees', function () {
    $mara = User::factory()->create();
    $public = WorkItem::factory()->for(Project::factory()->public())->create();
    WorkItem::factory()->for(Project::factory()->private())->create();

    expect(WorkItem::query()->visibleTo($mara)->pluck('id')->all())->toBe([$public->id]);
});

it('refuses a second item with the same number in a project', function () {
    $item = WorkItem::factory()->create();

    WorkItem::factory()->for($item->project)->create(['number' => $item->number]);
})->throws(UniqueConstraintViolationException::class);

it('stores the rank as ASCII compared by bytes', function () {
    $column = collect(DB::select("show full columns from `work_items` where Field = 'rank'"))->sole();

    expect($column->Collation)->toBe('ascii_bin')->and($column->Type)->toBe('varchar(128)');
});
