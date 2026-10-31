<?php

use App\Actions\Workflows\DeleteWorkflow;
use App\Actions\Workflows\SaveWorkflow;
use App\Events\EventType;
use App\Models\User;
use App\Models\Workflow;
use App\Support\CatalogLock;
use Illuminate\Validation\ValidationException;
use Tests\Support\RaceConnections;
use Tests\Support\WorkflowFixtures;

/*
 * Every change of a catalog takes the lock of the organization first (CatalogLock) and checks its rules under it: one
 * default workflow, the order of states, a workflow in use, unique names. Two connections as in the other race tests:
 * `mariadb` holds its transaction open like a request in progress, `mariadb_second` is the other request and gives up
 * waiting for a lock after one second. Without the lock the second change would read what it saw before and wait, if at
 * all, for a row it writes, not for the organization.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('makes every change of the catalog wait for the lock of the organization', function (Closure $change) {
    $admin = User::factory()->admin()->create();
    $workflow = Workflow::factory()->create(['name' => 'Alt']);

    // connection 1: another change of the catalog is in progress
    RaceConnections::hold(fn () => CatalogLock::take());

    // connection 2: this change waits for it instead of checking against what it read before
    RaceConnections::expectLockWait(RaceConnections::second(fn () => $change($admin, $workflow)), 'organization');
})->with([
    'create a workflow' => [fn (User $admin, Workflow $workflow) => SaveWorkflow::run(actor($admin), null, WorkflowFixtures::agencyInput())],
    'change a workflow' => [fn (User $admin, Workflow $workflow) => SaveWorkflow::run(actor($admin), $workflow, [...WorkflowFixtures::inputOf($workflow), 'name' => 'Neu'])],
    'delete a workflow' => [fn (User $admin, Workflow $workflow) => DeleteWorkflow::run(actor($admin), $workflow)],
]);

it('lets only one of two workflows become the default', function () {
    $admin = User::factory()->admin()->create();
    $a = SaveWorkflow::run(actor($admin), null, WorkflowFixtures::agencyInput('A'));
    $b = SaveWorkflow::run(actor($admin), null, WorkflowFixtures::standardInput('B'));
    $defaultInput = fn (Workflow $workflow) => [...WorkflowFixtures::inputOf($workflow), 'is_default' => true];

    // connection 1: A becomes the default, the transaction stays open
    RaceConnections::hold(fn () => SaveWorkflow::run(actor($admin), $a, $defaultInput($a)));

    // connection 2: B wants the mark too and waits instead of taking it from the Standard workflow it still sees
    RaceConnections::expectLockWait(RaceConnections::second(fn () => SaveWorkflow::run(actor($admin), $b, $defaultInput($b))), 'organization');

    RaceConnections::release();

    // once A is the default, B takes the mark from A
    expect(RaceConnections::second(fn () => SaveWorkflow::run(actor($admin), $b, $defaultInput($b))))->toBeInstanceOf(Workflow::class)
        ->and(Workflow::query()->where('is_default', true)->pluck('id')->all())->toBe([$b->id])
        ->and(eventsOf(EventType::WorkflowUpdated, $a)->map(fn ($event) => $event->changes)->all())->toBe([
            ['is_default' => ['old' => false, 'new' => true]],
            ['is_default' => ['old' => true, 'new' => false]],
        ]);
});

it('checks a name under the lock, against the name another change has just saved', function (Closure $change) {
    $admin = User::factory()->admin()->create();
    $old = Workflow::factory()->create(['name' => 'Alt']);

    // connection 1: a new workflow Prüfung, the transaction stays open
    RaceConnections::hold(fn () => SaveWorkflow::run(actor($admin), null, WorkflowFixtures::agencyInput('Prüfung')));

    // it commits the moment connection 2 asks for the lock: a check before the lock would miss the name, and the
    // unique index would end the change with a server error
    RaceConnections::releaseBeforeLock('organization');
    $outcome = RaceConnections::second(fn () => $change($admin, $old));

    expect($outcome)->toBeInstanceOf(ValidationException::class);
    assert($outcome instanceof ValidationException);
    expect($outcome->errors())->toBe(['name' => [__('field.name.taken')]])
        ->and(Workflow::query()->orderBy('id')->pluck('name')->all())->toBe(['Standard', 'Alt', 'Prüfung']);
})->with([
    'a new workflow' => [fn (User $admin, Workflow $old) => SaveWorkflow::run(actor($admin), null, WorkflowFixtures::standardInput('prüfung'))],
    'a renamed workflow' => [fn (User $admin, Workflow $old) => SaveWorkflow::run(actor($admin), $old, [...WorkflowFixtures::inputOf($old), 'name' => 'PRÜFUNG'])],
]);
