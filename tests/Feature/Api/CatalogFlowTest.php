<?php

use App\Models\User;
use App\Models\WorkItemType;

/*
 * Success criteria 2.1 and 2.2 of the spec through REST alone, as an integration would do it: Mara, org admin, with a
 * token that reads and writes. 2.1: a workflow with a matrix, assigned to a project. 2.2: a property and a type that
 * asks for it, switched on in the project and made its default type. The second half of 2.2 (an item of that type,
 * which asks for the property) and 2.3 follow in Phase 4, when there are items.
 */

it('builds a workflow, a property and a type and gives them to a project, all over REST', function () {
    $mara = User::factory()->admin()->create(['name' => 'Mara Lindqvist', 'email' => 'mara@example.com']);
    $this->withToken(apiToken($mara, ['read', 'write']));

    // 2.1: a matrix without the step from Todo straight to Done
    $workflow = $this->postJson('/api/v1/workflows', [
        'name' => 'Agentur-Freigabe',
        'description' => 'Mit Prüfung vor dem Abschluss.',
        'is_default' => false,
        'is_free' => false,
        'initial_state_id' => 'todo',
        'states' => [
            ['id' => 'todo', 'name' => 'Todo', 'icon' => 'circle', 'category' => 'unstarted'],
            ['id' => 'review', 'name' => 'Review', 'icon' => 'three-quarter', 'category' => 'started'],
            ['id' => 'done', 'name' => 'Done', 'icon' => 'check', 'category' => 'completed'],
        ],
        'transitions' => [['todo', 'review'], ['review', 'done'], ['review', 'todo']],
    ])->assertCreated()->json('data');

    expect(collect($workflow['transitions'])->contains(fn (array $pair) => $pair === [$workflow['states'][0]['id'], $workflow['states'][2]['id']]))->toBeFalse();

    $project = $this->postJson('/api/v1/projects', ['name' => 'Website', 'identifier' => 'WEB', 'lead_id' => $mara->id])
        ->assertCreated()->json('data');
    $this->putJson("/api/v1/projects/{$project['id']}/workflow", ['workflow_id' => $workflow['id'], 'mapping' => []])
        ->assertOk()->assertJsonPath('data.workflow_id', $workflow['id']);

    // 2.2: the property „Kunde“ with two options and the type „Kundenwunsch“ that asks for it
    $customer = $this->postJson('/api/v1/properties', [
        'key' => 'customer',
        'label' => 'Kunde',
        'field_type' => 'dropdown',
        'help' => 'Für wen das Item gemacht wird.',
        'settings' => ['multiple' => false],
        'options' => [
            ['id' => 'opt_nordlicht', 'label' => 'Studio Nordlicht', 'color' => 'sky'],
            ['id' => 'opt_hafenkontor', 'label' => 'Hafenkontor', 'color' => 'ochre'],
        ],
        'default_value' => null,
    ])->assertCreated()->json('data');
    $wish = $this->postJson('/api/v1/work-item-types', [
        'name' => 'Kundenwunsch',
        'icon' => 'message-square-heart',
        'tone' => 'plum',
        'description' => 'Ein Wunsch, der vor der Umsetzung freigegeben wird.',
        'is_epic' => false,
        'properties' => [['property_id' => $customer['id'], 'required' => true]],
    ])->assertCreated()->assertJsonPath('data.properties.0.required', true)->json('data');

    $types = [...$project['enabled_type_ids'], $wish['id']];
    $this->patchJson('/api/v1/projects/WEB', ['enabled_type_ids' => $types, 'default_type_id' => $wish['id']])->assertOk();

    $this->getJson("/api/v1/projects/{$project['id']}")->assertOk()
        ->assertJsonPath('data.workflow_id', $workflow['id'])
        ->assertJsonPath('data.enabled_type_ids', WorkItemType::query()->orderBy('id')->pluck('id')->all())
        ->assertJsonPath('data.enabled_type_ids.3', $wish['id'])
        ->assertJsonPath('data.default_type_id', $wish['id']);

    // the second half of 2.2 (an item of „Kundenwunsch“ asks for the customer) and 2.3 come with the items in Phase 4
});
