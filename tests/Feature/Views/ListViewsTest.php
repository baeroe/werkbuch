<?php

use App\Actions\Views\GetView;
use App\Actions\Views\ListViews;
use App\Actions\Views\SaveView;
use App\Domain\Filter\FieldKind;
use App\Domain\Views\Layout;
use App\Models\Property;
use App\Models\User;
use App\Models\View;

it('lists every view by name for every account', function () {
    $ida = User::factory()->create();
    $b = View::factory()->create(['name' => 'Bugs', 'created_by' => $ida->id]);
    $a = View::factory()->create(['name' => 'Alles offen']);
    $c = View::factory()->create(['name' => 'Bugs']);
    [$first, $second] = strcmp($b->id, $c->id) < 0 ? [$b, $c] : [$c, $b];

    foreach ([User::factory()->create(), User::factory()->admin()->create(), User::defaultBot()] as $reader) {
        $this->actingAs($reader)->getJson('/api/v1/views')->assertOk()
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('data.*.id', [$a->id, $first->id, $second->id]);
    }
});

it('reads a stored view whose property is gone', function () {
    $customer = Property::factory()->create(['key' => 'customer']);
    $ida = User::factory()->create();
    $filter = ['version' => 1, 'conditions' => [['field' => 'property:customer', 'op' => 'is_not_empty']]];
    $display = ['layout' => 'table', 'group_by' => 'none', 'sort' => ['field' => 'property:customer', 'direction' => 'desc'], 'fields' => ['key', 'property:customer'], 'show_sub_items' => false];
    $view = SaveView::run(actor($ida), ['name' => 'Kunden', 'icon' => 'users', 'filter' => $filter, 'display' => $display]);

    $customer->delete();
    app()->forgetScopedInstances();

    $this->actingAs(User::factory()->create())->getJson("/api/v1/views/{$view->id}")->assertOk()
        ->assertJsonPath('data.filter', $filter)
        ->assertJsonPath('data.display', $display);

    $read = GetView::run(actor($ida), $view->refresh());
    expect($read->filter()->conditions[0]->resolved)->toBeNull()
        ->and($read->display()->fields)->toBe(['key'])
        ->and($read->display()->sort->field)->toBe('rank')
        ->and($read->display()->layout)->toBe(Layout::Table);
});

it('reads the filter and display of a view against the catalog', function () {
    $view = View::factory()->create(['filter' => ['version' => 1, 'conditions' => [['field' => 'due_date', 'op' => 'overdue']]]]);

    expect($view->filter()->conditions[0]->resolved?->kind)->toBe(FieldKind::Date)
        ->and($view->display()->toArray())->toBe($view->display);
});

it('answers a view with its stamps, filter and display always objects', function () {
    $ida = User::factory()->create();
    $view = View::factory()->create(['created_by' => $ida->id]);

    $response = $this->actingAs($ida)->getJson("/api/v1/views/{$view->id}")->assertOk()
        ->assertExactJson(['data' => [
            'id' => $view->id,
            'name' => $view->name,
            'icon' => 'layers',
            'filter' => ['version' => 1, 'conditions' => []],
            'display' => $view->display,
            'created_by' => $ida->id,
            'created_at' => $view->created_at?->toJSON(),
            'updated_at' => $view->updated_at?->toJSON(),
        ]]);

    expect($response->getContent())->toContain('"filter":{"version":1,"conditions":[]}');
});

it('lets a deactivated account read no view', function () {
    $view = View::factory()->create();
    $gone = User::factory()->create(['disabled_at' => now()]);

    expect(problemOf(fn () => GetView::run(actor($gone), $view))->status)->toBe(404)
        ->and(problemOf(fn () => ListViews::run(actor($gone), []))->status)->toBe(404);
});
