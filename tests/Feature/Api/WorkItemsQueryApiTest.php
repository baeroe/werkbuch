<?php

use App\Access\ProjectRole;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Properties\FieldType;
use App\Models\Label;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\View;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemType;
use App\Views\CatalogProperties;
use App\Views\Shorthand;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/*
 * `POST /api/v1/work-items/query` and `GET /api/v1/work-items` over REST: one engine for the view, the long and the
 * short form, a read-only token may query, lean answers leave the descriptions out, a page asks the database a fixed
 * number of times.
 */

/** A rich text document of one paragraph. */
$doc = fn (string $text): array => ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $text]]]]];

/**
 * Today is Wednesday 2026-10-28 in Europe/Berlin, the week starts on Monday. WEB with Mara (the reader) and Jonas as
 * members; Task has a customer (dropdown), reviewers (people, several), notes (rich text), billable (yes or no) and the
 * built-in effort. Four tasks:
 *
 * - Alpha: Mara, In Progress, UX, due 10-29, created 10-27, effort 5, notes "Kontaktformular prüfen", Nordlicht,
 *   reviewer Mara, billable.
 * - Beta: Jonas, Todo, due 11-10, created 10-01, effort 2, not billable, blocked by Gamma.
 * - Gamma Release: nobody, Backlog, Formulare, created 10-25, notes "Release Notes", Bäckerei Korn, reviewer Jonas.
 * - Delta: Mara, In Progress, UX, due 10-26, created 10-20, effort 3, not billable.
 */
beforeEach(function () use ($doc) {
    $this->travelTo(Carbon::parse('2026-10-28 10:00', 'Europe/Berlin'));
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'week_start' => 1]);

    $this->mara = User::factory()->create(['name' => 'Mara']);
    $this->jonas = User::factory()->create(['name' => 'Jonas']);
    $this->web = Project::factory()->identifier('WEB')->public()
        ->member($this->mara, ProjectRole::Member)->member($this->jonas, ProjectRole::Member)->create();
    $admin = User::factory()->admin()->create();

    $property = fn (string $key, FieldType $type, array $settings = []) => Property::factory()->create(['key' => $key, 'label' => $key, 'field_type' => $type, 'settings' => $settings]);
    $this->properties = [
        'customer' => Property::factory()->dropdown(['Nordlicht', 'Bäckerei Korn'])->create(['key' => 'customer', 'label' => 'Kunde']),
        'reviewer' => $property('reviewer', FieldType::Member, ['multiple' => true]),
        'notes' => $property('notes', FieldType::RichText),
        'billable' => $property('billable', FieldType::Boolean),
        'effort' => Property::query()->where('key', 'effort')->sole(),
    ];
    $task = WorkItemType::query()->where('name', 'Task')->sole();
    $task->typeProperties()->delete();
    foreach (array_values($this->properties) as $position => $p) {
        $task->typeProperties()->create(['property_id' => $p->id, 'required' => false, 'position' => $position]);
    }
    app()->instance(CatalogProperties::class, CatalogProperties::load());

    $this->option = fn (string $label): string => $this->properties['customer']->options()->where('label', $label)->sole()->id;
    $state = fn (string $name): string => WorkflowState::query()->where('workflow_id', Workflow::default()->id)->where('name', $name)->sole()->id;
    $this->ux = Label::factory()->create(['name' => 'UX']);
    $this->forms = Label::factory()->create(['name' => 'Formulare']);

    $item = function (string $title, array $attributes, array $labels, array $values) use ($task, $admin) {
        $item = WorkItem::factory()->for($this->web)->create(['type_id' => $task->id, 'title' => $title, 'assignee_id' => null, ...$attributes]);
        $item->labels()->attach(array_map(fn (Label $label) => $label->id, $labels));
        if ($values !== []) {
            UpdateWorkItem::run(actor($admin), $item, ['values' => $values]);
        }

        return $item;
    };
    $this->items = [
        'Alpha' => $item('Alpha', ['assignee_id' => $this->mara->id, 'state_id' => $state('In Progress'), 'due_date' => '2026-10-29', 'created_at' => '2026-10-27 09:00:00'], [$this->ux], [
            'effort' => 5, 'notes' => $doc('Kontaktformular prüfen'), 'customer' => ($this->option)('Nordlicht'), 'reviewer' => [$this->mara->id], 'billable' => true,
        ]),
        'Beta' => $item('Beta', ['assignee_id' => $this->jonas->id, 'state_id' => $state('Todo'), 'due_date' => '2026-11-10', 'created_at' => '2026-10-01 09:00:00'], [], [
            'effort' => 2, 'billable' => false,
        ]),
        'Gamma Release' => $item('Gamma Release', ['state_id' => $state('Backlog'), 'created_at' => '2026-10-25 09:00:00'], [$this->forms], [
            'notes' => $doc('Release Notes'), 'customer' => ($this->option)('Bäckerei Korn'), 'reviewer' => [$this->jonas->id],
        ]),
        'Delta' => $item('Delta', ['assignee_id' => $this->mara->id, 'state_id' => $state('In Progress'), 'due_date' => '2026-10-26', 'created_at' => '2026-10-20 09:00:00'], [$this->ux], [
            'effort' => 3, 'billable' => false,
        ]),
    ];
    WorkItemRelation::factory()->blocks()->create(['source_id' => $this->items['Gamma Release']->id, 'target_id' => $this->items['Beta']->id]);
    $this->ids = fn (string ...$titles): array => array_map(fn (string $title) => $this->items[$title]->id, $titles);
});

/** The ULIDs of the answer, in its order. */
$ids = fn ($response): array => array_column($response->assertOk()->json('data'), 'id');

it('lets a read-only token query', function () {
    $read = apiToken($this->mara, ['read']);
    $this->withToken($read)->postJson('/api/v1/work-items/query', ['shorthand' => ['project' => 'WEB']])->assertOk()
        ->assertJsonPath('meta.total', 4);

    forgetApiAuth();
    $this->withToken(apiToken($this->mara, ['write']))->postJson('/api/v1/work-items/query', [])->assertForbidden()
        ->assertJsonPath('reason', 'forbidden')
        ->assertJsonPath('detail', __('problem.detail.token_ability', ['ability' => 'read']));

    // the default is the route's only: every other write still needs `write`
    forgetApiAuth();
    $this->withToken($read)->postJson('/api/v1/work-items/bulk', ['ids' => ['WEB-1'], 'patch' => ['priority' => 'high']])->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.token_ability', ['ability' => 'write']));
});

it('gives the same items for ?view= as for the filter of the view, for every kind of field', function (Closure $condition, array $expected) use ($ids) {
    $filter = ['version' => 1, 'conditions' => [$condition($this)]];
    $sort = ['field' => 'due_date', 'direction' => 'desc'];
    $view = View::factory()->create(['filter' => $filter, 'display' => [
        'layout' => 'board', 'group_by' => 'none', 'sort' => $sort, 'fields' => [], 'show_sub_items' => true,
    ]]);

    $viewed = $ids($this->actingAs($this->mara)->getJson("/api/v1/work-items?view={$view->id}"));
    $queried = $ids($this->actingAs($this->mara)->postJson('/api/v1/work-items/query', ['filter' => $filter, 'sort' => $sort]));

    expect($viewed)->toBe($queried)->toBe(($this->ids)(...$expected));
})->with([
    'id' => [fn ($t) => ['field' => 'assignee', 'op' => 'is', 'value' => 'me'], ['Alpha', 'Delta']],
    'enum' => [fn ($t) => ['field' => 'state_category', 'op' => 'in', 'value' => ['started']], ['Alpha', 'Delta']],
    'list' => [fn ($t) => ['field' => 'label', 'op' => 'in', 'value' => [$t->forms->id]], ['Gamma Release']],
    'date' => [fn ($t) => ['field' => 'due_date', 'op' => 'is', 'value' => 'this_week'], ['Alpha', 'Delta']],
    'stamp' => [fn ($t) => ['field' => 'created_at', 'op' => 'after', 'value' => ['relative' => '-7d']], ['Alpha', 'Gamma Release']],
    'flag' => [fn ($t) => ['field' => 'blocked', 'op' => 'is', 'value' => true], ['Beta']],
    'text' => [fn ($t) => ['field' => 'title', 'op' => 'contains', 'value' => 'release'], ['Gamma Release']],
    'number' => [fn ($t) => ['field' => 'property:effort', 'op' => 'gt', 'value' => 3], ['Alpha']],
    'rich' => [fn ($t) => ['field' => 'property:notes', 'op' => 'contains', 'value' => 'formular'], ['Alpha']],
    'dropdown' => [fn ($t) => ['field' => 'property:customer', 'op' => 'is', 'value' => ($t->option)('Nordlicht')], ['Alpha']],
    'member' => [fn ($t) => ['field' => 'property:reviewer', 'op' => 'in', 'value' => ['me']], ['Alpha']],
    'boolean' => [fn ($t) => ['field' => 'property:billable', 'op' => 'is', 'value' => false], ['Beta', 'Delta', 'Gamma Release']],
]);

it('narrows a view with the shorthand', function () use ($ids) {
    $view = View::factory()->create(['filter' => ['version' => 1, 'conditions' => [['field' => 'state_category', 'op' => 'in', 'value' => ['unstarted', 'started']]]]]);

    expect($ids($this->actingAs($this->mara)->getJson("/api/v1/work-items?view={$view->id}")))->toBe(($this->ids)('Alpha', 'Beta', 'Delta'))
        ->and($ids($this->actingAs($this->mara)->getJson("/api/v1/work-items?view={$view->id}&filter[assignee]=me")))->toBe(($this->ids)('Alpha', 'Delta'))
        ->and($ids($this->actingAs($this->mara)->postJson('/api/v1/work-items/query', ['view_id' => $view->id, 'shorthand' => ['assignee' => 'me']])))->toBe(($this->ids)('Alpha', 'Delta'));
});

it('reads the shorthand into the same engine', function () use ($ids) {
    $short = $ids($this->actingAs($this->mara)->getJson('/api/v1/work-items?filter[project]=WEB&filter[assignee]=me&filter[state_category]=unstarted,started'));
    $long = $ids($this->actingAs($this->mara)->postJson('/api/v1/work-items/query', ['filter' => ['version' => 1, 'conditions' => [
        ['field' => 'project', 'op' => 'is', 'value' => $this->web->id],
        ['field' => 'assignee', 'op' => 'is', 'value' => 'me'],
        ['field' => 'state_category', 'op' => 'in', 'value' => ['unstarted', 'started']],
    ]]]));

    expect($short)->toBe($long)->toBe(($this->ids)('Alpha', 'Delta'))
        ->and($ids($this->actingAs($this->mara)->getJson('/api/v1/work-items?filter[assignee]=none')))->toBe(($this->ids)('Gamma Release'))
        ->and($ids($this->actingAs($this->mara)->getJson("/api/v1/work-items?filter[label]={$this->forms->id},{$this->ux->id}")))->toBe(($this->ids)('Alpha', 'Gamma Release', 'Delta'));
});

it('answers 404 for the shorthand project the reader does not see, as before', function () {
    $ops = Project::factory()->identifier('OPS')->private()->create();
    WorkItem::factory()->for($ops)->create();

    foreach ([$ops->id, 'OPS', 'NOPE'] as $ref) {
        $this->actingAs($this->mara)->getJson("/api/v1/work-items?filter[project]={$ref}")->assertNotFound();
        $this->actingAs($this->mara)->postJson('/api/v1/work-items/query', ['shorthand' => ['project' => $ref]])->assertNotFound();
    }
});

it('refuses an unknown shorthand', function () {
    $keys = implode(', ', Shorthand::KEYS);
    $this->actingAs($this->mara)->getJson('/api/v1/work-items?filter[foo]=x')->assertUnprocessable()
        ->assertJsonPath('errors', ['filter' => [__('field.filter.invalid', ['keys' => $keys])]]);
    $this->actingAs($this->mara)->postJson('/api/v1/work-items/query', ['shorthand' => ['foo' => 'x']])->assertUnprocessable()
        ->assertJsonPath('errors', ['shorthand' => [__('field.filter.invalid', ['keys' => $keys])]]);
});

it('sorts with -due_date', function () use ($ids) {
    expect($ids($this->actingAs($this->mara)->getJson('/api/v1/work-items?sort=-due_date')))->toBe(($this->ids)('Beta', 'Alpha', 'Delta', 'Gamma Release'))
        ->and($ids($this->actingAs($this->mara)->getJson('/api/v1/work-items?sort=due_date')))->toBe(($this->ids)('Delta', 'Alpha', 'Beta', 'Gamma Release'));
    $this->actingAs($this->mara)->getJson('/api/v1/work-items?sort=title')->assertUnprocessable()
        ->assertJsonPath('errors', ['sort' => [__('field.sort.invalid')]]);
});

it('leaves out descriptions with lean', function () use ($doc) {
    $alpha = $this->items['Alpha'];
    $alpha->update(['description' => $doc('Beschreibung')]);
    $lean = ['description', 'description_json', 'values_markdown'];

    $full = $this->actingAs($this->mara)->getJson('/api/v1/work-items?filter[q]=WEB-1')->assertOk()->json('data.0');
    $listed = $this->actingAs($this->mara)->getJson('/api/v1/work-items?filter[q]=WEB-1&lean=1')->assertOk()->json('data.0');
    $queried = $this->actingAs($this->mara)->postJson('/api/v1/work-items/query', ['q' => 'WEB-1', 'lean' => true])->assertOk()->json('data.0');

    expect(array_keys($full))->toContain(...$lean)
        ->and($full['description'])->toBe('Beschreibung')
        ->and(array_keys($listed))->toBe(array_values(array_diff(array_keys($full), $lean)))
        ->and($queried)->toBe($listed)
        // the rich text values stay (the table shows them)
        ->and($listed['values']['notes'])->toBe($doc('Kontaktformular prüfen'));
});

it('asks the database a fixed number of times for a page', function () {
    $epic = WorkItem::factory()->for($this->web)->epic()->create();
    $children = function (int $count) use ($epic) {
        foreach (range(1, $count) as $n) {
            $child = WorkItem::factory()->for($this->web)->childOf($epic)->create(['title' => "Kind {$n}"]);
            $child->labels()->attach([$this->ux->id, $this->forms->id]);
            $child->values()->create(['property_id' => $this->properties['effort']->id, 'position' => 0, 'value_number' => $n]);
            WorkItemRelation::factory()->create(['source_id' => $child->id, 'target_id' => $epic->id]);
        }
    };
    $count = function (array $body): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->actingAs($this->mara)->postJson('/api/v1/work-items/query', $body)->assertOk();
        DB::disableQueryLog();

        return count(DB::getQueryLog());
    };
    $body = ['shorthand' => ['parent' => $epic->id], 'sort' => ['field' => 'property:effort', 'direction' => 'desc']];

    $children(5);
    // the first request of the test also reads what the app keeps for the rest of it (the account, the organisation)
    $count($body);
    $few = [$count($body), $count([...$body, 'lean' => true])];
    $children(95);
    $many = [$count($body), $count([...$body, 'lean' => true])];

    expect($many)->toBe($few);
});
