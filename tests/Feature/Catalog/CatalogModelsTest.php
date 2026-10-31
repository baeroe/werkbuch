<?php

use App\Domain\Catalog\Tone;
use App\Domain\Properties\FieldType;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Models\Label;
use App\Models\Project;
use App\Models\ProjectType;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\TypeProperty;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkflowTransition;
use App\Models\WorkItemType;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

it('orders the states of a workflow by position and builds its graph', function () {
    $workflow = Workflow::factory()->matrix([[0, 1], [1, 2]])->create();

    $backlog = $workflow->states[0];
    $doing = $workflow->states[1];
    $done = $workflow->states[2];

    expect($workflow->states->pluck('name')->all())->toBe(['Backlog', 'Doing', 'Done'])
        ->and($workflow->initial_state_id)->toBe($backlog->id)
        ->and($workflow->graph()->canTransition($doing->id, $done->id))->toBeTrue()
        ->and($workflow->graph()->canTransition($done->id, $backlog->id))->toBeFalse()
        ->and($workflow->graph()->issues())->toBe([]);

    // the position decides, not the order of creation
    $backlog->update(['position' => 7]);

    expect($workflow->fresh()?->states->pluck('name')->all())->toBe(['Doing', 'Done', 'Backlog']);
});

it('orders states of the same position by id', function () {
    $workflow = Workflow::factory()->create();
    $workflow->states()->update(['position' => 0]);

    expect($workflow->fresh()?->states->pluck('id')->all())->toBe($workflow->states->pluck('id')->sort()->values()->all());
});

it('deletes states and transitions with their workflow', function () {
    $workflow = Workflow::factory()->matrix([[0, 1], [1, 2]])->create();
    $other = Workflow::factory()->matrix([[0, 2]])->create();

    expect(WorkflowState::query()->count())->toBe(6)->and(WorkflowTransition::query()->count())->toBe(3);

    $workflow->delete();

    expect(WorkflowState::query()->pluck('workflow_id')->unique()->all())->toBe([$other->id])
        ->and(WorkflowTransition::query()->pluck('workflow_id')->all())->toBe([$other->id]);
});

it('deletes the options and the type assignments with a property', function () {
    $property = Property::factory()->dropdown(['Safari', 'Chrome'])->create();
    $keep = Property::factory()->dropdown(['A'])->create();
    $type = WorkItemType::factory()->create();
    TypeProperty::query()->create(['type_id' => $type->id, 'property_id' => $property->id, 'required' => true, 'position' => 0]);
    TypeProperty::query()->create(['type_id' => $type->id, 'property_id' => $keep->id, 'required' => false, 'position' => 1]);

    expect($property->options->pluck('label')->all())->toBe(['Safari', 'Chrome'])
        ->and($type->typeProperties->pluck('property_id')->all())->toBe([$property->id, $keep->id]);

    $property->delete();

    expect(DB::table('property_options')->pluck('property_id')->all())->toBe([$keep->id])
        ->and(TypeProperty::query()->pluck('property_id')->all())->toBe([$keep->id]);
});

it('orders the properties of a type by position and the options of a property by position', function () {
    $type = WorkItemType::factory()->create();
    $first = Property::factory()->create();
    $second = Property::factory()->create();
    TypeProperty::query()->create(['type_id' => $type->id, 'property_id' => $first->id, 'required' => false, 'position' => 1]);
    TypeProperty::query()->create(['type_id' => $type->id, 'property_id' => $second->id, 'required' => true, 'position' => 0]);

    expect($type->typeProperties->pluck('property_id')->all())->toBe([$second->id, $first->id])
        ->and($type->typeProperties[0]->required)->toBeTrue()
        ->and($type->typeProperties[0]->type->is($type))->toBeTrue()
        ->and($type->typeProperties[0]->property->is($second))->toBeTrue();
});

it('takes a deleted type out of the projects that had it switched on', function () {
    $project = Project::factory()->create();
    $keep = WorkItemType::factory()->create();
    $type = WorkItemType::factory()->create();

    $project->types()->sync([$keep->id, $type->id]);

    $pivot = ProjectType::query()->where('type_id', $type->id)->sole();
    expect(Str::isUlid($pivot->id))->toBeTrue()
        ->and($project->types()->pluck('work_item_types.id')->all())->toBe([$keep->id, $type->id]);

    $type->delete();

    expect(ProjectType::query()->pluck('type_id')->all())->toBe([$keep->id]);
});

it('refuses a second transition between the same pair and a second built-in type of one kind', function (Closure $duplicate) {
    $duplicate();
})->with([
    'transition' => function () {
        $workflow = Workflow::factory()->matrix([[0, 1]])->create();
        [$from, $to] = [$workflow->states[0]->id, $workflow->states[1]->id];
        WorkflowTransition::query()->create(['workflow_id' => $workflow->id, 'from_state_id' => $from, 'to_state_id' => $to]);
    },
    'built-in relation type' => function () {
        RelationType::factory()->create(['built_in' => 'blocks']);
        RelationType::factory()->create(['built_in' => 'blocks']);
    },
    'default resolution' => function () {
        Resolution::factory()->create(['default_for' => 'completed']);
        Resolution::factory()->create(['default_for' => 'completed']);
    },
    'property key' => function () {
        Property::factory()->create(['key' => 'customer']);
        Property::factory()->create(['key' => 'Customer']);
    },
    'label name' => function () {
        Label::factory()->create(['name' => 'Backend']);
        Label::factory()->create(['name' => 'backend']);
    },
    'type name' => function () {
        WorkItemType::factory()->create(['name' => 'Bug']);
        WorkItemType::factory()->create(['name' => 'bug']);
    },
])->throws(UniqueConstraintViolationException::class);

it('allows several relation types and resolutions without a built-in or default marker', function () {
    RelationType::factory()->count(2)->create();
    Resolution::factory()->count(2)->create();
    RelationType::factory()->create(['built_in' => 'blocks']);
    Resolution::factory()->create(['default_for' => 'completed']);
    Resolution::factory()->create(['default_for' => 'canceled']);

    expect(RelationType::query()->count())->toBe(3)->and(Resolution::query()->count())->toBe(4);
});

it('casts tones, icons, categories and field types to their enums', function () {
    $workflow = Workflow::factory()->create();
    $state = $workflow->states()->create(['name' => 'Review', 'icon' => 'three-quarter', 'category' => 'started', 'position' => 3])->fresh();
    $property = Property::factory()->dropdown(['A'])->create(['field_type' => 'dropdown'])->fresh();
    $type = WorkItemType::factory()->create(['tone' => 'plum'])->fresh();
    $label = Label::factory()->create(['color' => 'moss'])->fresh();

    expect($state?->icon)->toBe(StateIcon::ThreeQuarter)
        ->and($state?->category)->toBe(StateCategory::Started)
        ->and($state?->position)->toBe(3)
        ->and($property?->field_type)->toBe(FieldType::Dropdown)
        ->and($property?->options[0]->color)->toBe(Tone::Sky)
        ->and($type?->tone)->toBe(Tone::Plum)
        ->and($label?->color)->toBe(Tone::Moss)
        ->and($workflow->fresh()?->is_free)->toBeTrue()
        ->and($workflow->fresh()?->is_default)->toBeFalse();
});

it('casts the archive markers to dates', function () {
    $type = WorkItemType::factory()->archived()->create()->fresh();
    $resolution = Resolution::factory()->create(['archived_at' => now()])->fresh();
    $option = Property::factory()->dropdown(['A'])->create()->options[0];
    $option->update(['archived_at' => now()]);

    expect($type?->archived_at?->isToday())->toBeTrue()
        ->and($resolution?->archived_at?->isToday())->toBeTrue()
        ->and($option->fresh()?->archived_at?->isToday())->toBeTrue()
        ->and(WorkItemType::factory()->epic()->create()->fresh()?->is_epic)->toBeTrue();
});

it('keeps the settings of a property as an array, empty as well', function () {
    $empty = Property::factory()->create()->fresh();
    $decimals = Property::factory()->create(['field_type' => FieldType::Number, 'settings' => ['decimals' => 2], 'default_value' => 1.5])->fresh();
    $flag = Property::factory()->create(['field_type' => FieldType::Boolean, 'default_value' => false])->fresh();

    expect($empty?->settings)->toBe([])->and($empty?->default_value)->toBeNull()
        ->and($decimals?->settings)->toBe(['decimals' => 2])->and($decimals?->default_value)->toBe(1.5)
        ->and($flag?->default_value)->toBeFalse();
});

it('finds the one default workflow', function () {
    $default = Workflow::factory()->create(['is_default' => true]);
    Workflow::factory()->create();

    expect(Workflow::default()->is($default))->toBeTrue();
});

it('has no default workflow without the marker', function () {
    Workflow::factory()->create();

    Workflow::default();
})->throws(ModelNotFoundException::class);

it('knows the workflow of a project', function () {
    $workflow = Workflow::factory()->create();
    $project = Project::factory()->create(['workflow_id' => $workflow->id]);

    expect($project->workflow->is($workflow))->toBeTrue();
});

it('puts the next resolution behind the last one', function () {
    $first = Resolution::factory()->create();
    $second = Resolution::factory()->create();

    expect([$first->position, $second->position])->toBe([0, 1]);
});
