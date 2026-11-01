<?php

use App\Access\ProjectRole;
use App\Actions\Workflows\ListStateUsage;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItem;

/*
 * GET /api/v1/state-usage: how many items stand in each state, for the mapping of states (ListStateUsage). Of one
 * project the account sees, or of the projects of a workflow the account sees; archived items count, empty states are
 * left out.
 */

/** The id of the state of that name in the default workflow. */
$state = fn (string $name): string => (string) Workflow::default()->states()->where('name', $name)->value('id');

/** The usage as the answer sorts it (by state id). */
$usage = function (array $counts) use ($state): array {
    $rows = array_map(fn (string $name, int $items) => ['state_id' => $state($name), 'items' => $items], array_keys($counts), $counts);
    usort($rows, fn (array $a, array $b) => strcmp($a['state_id'], $b['state_id']));

    return $rows;
};

it('counts the items per state of a project, archived ones too', function () use ($usage) {
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Viewer)->private()->create();
    WorkItem::factory()->for($web)->inState('Todo')->count(2)->create();
    WorkItem::factory()->for($web)->archived()->create();
    WorkItem::factory()->for(Project::factory()->identifier('OPS')->create())->inState('Todo')->create();

    $this->actingAs($mara)->getJson('/api/v1/state-usage?project=web')
        ->assertOk()->assertExactJson(['data' => $usage(['Todo' => 2, 'Done' => 1])]);

    // a project without items: nothing to count
    Project::factory()->identifier('APP')->create();
    $this->getJson('/api/v1/state-usage?project=APP')->assertOk()->assertExactJson(['data' => []]);
});

it('counts per workflow over the projects the account sees', function () use ($usage) {
    $member = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $agency = Workflow::factory()->create(['name' => 'Agentur-Freigabe']);
    $app = Project::factory()->identifier('APP')->create(['workflow_id' => $agency->id]);
    WorkItem::factory()->for($web)->inState('Todo')->create();
    WorkItem::factory()->for($ops)->inState('Todo')->count(2)->create();
    WorkItem::factory()->for($ops)->inState('Pending')->create();
    WorkItem::factory()->for($app)->create();

    $this->actingAs($member)->getJson('/api/v1/state-usage?workflow='.strtoupper(Workflow::default()->id))
        ->assertOk()->assertExactJson(['data' => $usage(['Todo' => 1])]);
    $this->actingAs(User::factory()->admin()->create())->getJson('/api/v1/state-usage?workflow='.Workflow::default()->id)
        ->assertOk()->assertExactJson(['data' => $usage(['Todo' => 3, 'Pending' => 1])]);
});

it('answers 404 for a project the account does not see', function () {
    $ops = Project::factory()->identifier('OPS')->private()->create();
    WorkItem::factory()->for($ops)->create();
    $outsider = User::factory()->create();

    $this->actingAs($outsider)->getJson('/api/v1/state-usage?project=OPS')->assertNotFound()->assertJsonMissingPath('detail');
    $this->getJson('/api/v1/state-usage?project=NOPE')->assertNotFound();
    $this->getJson('/api/v1/state-usage?project[]=OPS')->assertNotFound();

    // nor once it is being deleted, not even for an org admin
    $ops->update(['deleting_at' => now()]);
    $this->actingAs(User::factory()->admin()->create())->getJson('/api/v1/state-usage?project=OPS')->assertNotFound();
});

it('asks for either a project or a workflow', function (array $query, string $message) {
    $this->actingAs(User::factory()->create());
    Project::factory()->identifier('WEB')->create();

    $this->getJson('/api/v1/state-usage?'.http_build_query($query))
        ->assertUnprocessable()->assertJsonPath('errors.workflow', [__($message)]);
})->with([
    'neither' => [[], 'field.state_usage.either'],
    'both' => [['project' => 'WEB', 'workflow' => '01jbxxxxxxxxxxxxxxxxxxxxxx'], 'field.state_usage.either'],
    'an unknown workflow' => [['workflow' => '01jbz5s1qyq4fd3x8ad0k8xk2v'], 'field.workflow_id.unknown'],
    'no ULID' => [['workflow' => 'standard'], 'field.workflow_id.unknown'],
    'no text' => [['workflow' => ['x']], 'field.workflow_id.unknown'],
]);

it('counts through the action as well, without a request', function () use ($usage) {
    $web = Project::factory()->identifier('WEB')->create();
    WorkItem::factory()->for($web)->inState('Pending')->create();

    expect(ListStateUsage::run(actor(User::factory()->create()), ['project' => $web->id]))->toBe($usage(['Pending' => 1]));
});
