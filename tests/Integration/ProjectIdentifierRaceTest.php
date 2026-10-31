<?php

use App\Actions\Projects\CreateProject;
use App\Actions\Projects\UpdateProject;
use App\Models\Project;
use App\Models\ProjectIdentifier;
use App\Models\User;
use Illuminate\Validation\ValidationException;
use Tests\Support\RaceConnections;

/*
 * Identifiers are unique across `projects` and `project_identifiers`, which no single index guards; CreateProject and
 * UpdateProject (with an identifier) take the row of the organization `lockForUpdate` first and check the identifier
 * under it. Two connections as in LastAdminRaceTest: `mariadb` holds its transaction open like a request in progress,
 * `mariadb_second` is the other request and gives up waiting for a lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

/**
 * The first message at `identifier` of the ValidationException that ended a call on the second connection.
 */
$identifierError = fn (mixed $outcome): ?string => $outcome instanceof ValidationException ? $outcome->errors()['identifier'][0] : null;

it('makes a new project wait for a rename and then finds the old identifier taken', function () use ($identifierError) {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);

    // connection 1: WEB becomes SITE, the transaction stays open
    RaceConnections::hold(fn () => UpdateProject::run(actor($admin), $web, ['identifier' => 'SITE']));

    // connection 2: a new project WEB waits for the lock instead of checking against what it read before
    RaceConnections::expectLockWait(RaceConnections::second(fn () => CreateProject::run(actor($admin), ['name' => 'Andere', 'identifier' => 'WEB'])), 'organization');

    RaceConnections::release();

    // once the rename is done, WEB is a former identifier and stays reserved
    expect($identifierError(RaceConnections::second(fn () => CreateProject::run(actor($admin), ['name' => 'Andere', 'identifier' => 'WEB']))))
        ->toBe(__('field.identifier.taken'))
        ->and(Project::query()->pluck('identifier')->all())->toBe(['SITE'])
        ->and(ProjectIdentifier::query()->pluck('identifier')->all())->toBe(['WEB']);
});

it('lets only one of two new projects with the same identifier through, without a server error', function () use ($identifierError) {
    $admin = User::factory()->admin()->create();

    RaceConnections::hold(fn () => CreateProject::run(actor($admin), ['name' => 'Betrieb', 'identifier' => 'OPS']));

    RaceConnections::expectLockWait(RaceConnections::second(fn () => CreateProject::run(actor($admin), ['name' => 'Auch Betrieb', 'identifier' => 'ops'])), 'organization');

    RaceConnections::release();

    expect($identifierError(RaceConnections::second(fn () => CreateProject::run(actor($admin), ['name' => 'Auch Betrieb', 'identifier' => 'ops']))))
        ->toBe(__('field.identifier.taken'))
        ->and(Project::query()->pluck('name')->all())->toBe(['Betrieb']);
});
