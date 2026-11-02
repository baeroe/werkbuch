<?php

use App\Access\ProjectRole;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Views\CatalogProperties;

/*
 * Success criterion 4 over REST: a team view with a filter on a property of our own gives the same items for
 * `GET /api/v1/work-items?view=<id>`, for `POST /query` with the view and for `POST /query` with its filter, in every
 * layout, and only from projects the reader sees; the timeline's query gives the epics with their progress.
 */

/**
 * Ida (member of WEB, not of OPS) reads with a read-only token, as `curl` would. The dropdown `e2e_customer` belongs to
 * Task and Bug, not to Epic. WEB (public):
 *
 * - Login (Task, Nordlicht, due 11-10), Logo (Bug, Nordlicht, due 11-12), Footer (Task, Korn), Header (Task, no customer)
 * - Relaunch (Epic, a value row Nordlicht left over: Epic has no customer) with Contact (Bug, Nordlicht, due 11-20) and
 *   Imprint (Task, done)
 * - Archive (Epic without children)
 *
 * OPS (private): Server (Task, Nordlicht) and Migration (Epic).
 */
beforeEach(function () {
    $this->ida = User::factory()->create(['name' => 'Ida']);
    $this->web = Project::factory()->identifier('WEB')->public()->member($this->ida, ProjectRole::Member)->create();
    $this->ops = Project::factory()->identifier('OPS')->private()->create();

    $customer = Property::factory()->dropdown(['Nordlicht', 'Bäckerei Korn'])->create(['key' => 'e2e_customer', 'label' => 'Kunde']);
    $this->nordlicht = $customer->options()->where('label', 'Nordlicht')->sole()->id;
    $korn = $customer->options()->where('label', 'Bäckerei Korn')->sole()->id;
    $type = fn (string $name) => WorkItemType::query()->where('name', $name)->sole();
    foreach (['Task', 'Bug'] as $name) {
        $type($name)->typeProperties()->create(['property_id' => $customer->id, 'required' => false, 'position' => 9]);
    }
    app()->instance(CatalogProperties::class, CatalogProperties::load());

    $item = function (Project $project, string $title, string $type, array $attributes = [], ?string $option = null) use ($customer) {
        $item = WorkItem::factory()->for($project)->create(['type_id' => WorkItemType::query()->where('name', $type)->sole()->id, 'title' => $title, ...$attributes]);
        if ($option !== null) {
            $item->values()->create(['property_id' => $customer->id, 'position' => 0, 'value_option_id' => $option]);
        }

        return $item;
    };
    $this->items = [
        'Login' => $item($this->web, 'Login', 'Task', ['due_date' => '2026-11-10'], $this->nordlicht),
        'Logo' => $item($this->web, 'Logo', 'Bug', ['due_date' => '2026-11-12'], $this->nordlicht),
        'Footer' => $item($this->web, 'Footer', 'Task', [], $korn),
        'Header' => $item($this->web, 'Header', 'Task'),
        'Relaunch' => $relaunch = $item($this->web, 'Relaunch', 'Epic', [], $this->nordlicht),
        'Contact' => $item($this->web, 'Contact', 'Bug', ['parent_id' => $relaunch->id, 'due_date' => '2026-11-20'], $this->nordlicht),
        'Archive' => $item($this->web, 'Archive', 'Epic'),
        'Server' => $item($this->ops, 'Server', 'Task', [], $this->nordlicht),
        'Migration' => $item($this->ops, 'Migration', 'Epic'),
    ];
    $this->items['Imprint'] = WorkItem::factory()->childOf($relaunch)->closed()->create(['type_id' => $type('Task')->id, 'title' => 'Imprint']);

    $this->filter = ['version' => 1, 'conditions' => [['field' => 'property:e2e_customer', 'op' => 'is', 'value' => $this->nordlicht]]];
    $this->view = fn (array $display) => View::factory()->create(['name' => 'Kunde Nordlicht', 'filter' => $this->filter, 'display' => [
        'layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'rank', 'direction' => 'asc'], 'fields' => ['key', 'title'], 'show_sub_items' => true, ...$display,
    ]]);
    $this->ids = fn (string ...$titles): array => array_map(fn (string $title) => $this->items[$title]->id, $titles);
    $this->token = apiToken($this->ida, ['read']);
});

/** The ULIDs of the answer, in its order. */
$ids = fn ($response): array => array_column($response->assertOk()->json('data'), 'id');

it('gives the same items over ?view=, the view and its filter, and none of a project the reader does not see', function () use ($ids) {
    $view = ($this->view)([]);

    $viewed = $ids($this->withToken($this->token)->getJson("/api/v1/work-items?view={$view->id}"));
    $byView = $ids($this->withToken($this->token)->postJson('/api/v1/work-items/query', ['view_id' => $view->id]));
    $byFilter = $ids($this->withToken($this->token)->postJson('/api/v1/work-items/query', ['filter' => $this->filter]));

    // the epic's value row does not count (Epic has no customer), Footer is somebody else's, OPS is hidden
    expect($viewed)->toBe($byView)->toBe($byFilter)->toBe(($this->ids)('Login', 'Logo', 'Contact'));

    // the same filter finds the item of OPS for whoever sees OPS
    forgetApiAuth();
    $admin = apiToken(User::factory()->admin()->create(), ['read']);
    expect($ids($this->withToken($admin)->getJson("/api/v1/work-items?view={$view->id}")))
        ->toEqualCanonicalizing(($this->ids)('Login', 'Logo', 'Contact', 'Server'));
});

it('takes the sort and the sub-items of the display, in whatever layout the view shows them', function (string $layout) use ($ids) {
    // the server never reads the layout (K35): what the display says about the order and the sub-items counts
    $view = ($this->view)(['layout' => $layout, 'sort' => ['field' => 'due_date', 'direction' => 'desc'], 'show_sub_items' => false]);

    $viewed = $ids($this->withToken($this->token)->getJson("/api/v1/work-items?view={$view->id}"));
    $byView = $ids($this->withToken($this->token)->postJson('/api/v1/work-items/query', ['view_id' => $view->id]));
    $byFilter = $ids($this->withToken($this->token)->postJson('/api/v1/work-items/query', [
        'filter' => $this->filter, 'sort' => ['field' => 'due_date', 'direction' => 'desc'], 'show_sub_items' => false,
    ]));

    expect($viewed)->toBe($byView)->toBe($byFilter)->toBe(($this->ids)('Logo', 'Login'));
})->with(['list', 'board', 'table']);

it('gives the timeline the epics the reader sees, with their progress', function () {
    $epics = $this->withToken($this->token)->postJson('/api/v1/work-items/query', [
        'filter' => ['version' => 1, 'conditions' => [['field' => 'epic', 'op' => 'is', 'value' => true]]],
    ])->assertOk()->json('data');

    expect(array_column($epics, 'id'))->toBe(($this->ids)('Relaunch', 'Archive'))
        ->and(array_column($epics, 'children_progress', 'title'))->toBe(['Relaunch' => ['done' => 1, 'total' => 2], 'Archive' => null]);
});
