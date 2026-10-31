<?php

use App\Actions\Projects\CreateProject;
use App\Actions\Projects\UpdateProject;
use App\Models\Project;
use App\Models\ProjectIdentifier;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/*
 * Identifiers are unique across `projects` and `project_identifiers`, which no single index guards; CreateProject and
 * UpdateProject (with an identifier) take the row of the organization `lockForUpdate` first and check the identifier
 * under it. Two connections as in LastAdminRaceTest: `mariadb` holds its transaction open like a request in progress,
 * `mariadb_second` is the other request and gives up waiting for a lock after one second.
 */

beforeEach(function () {
    config(['database.connections.mariadb_second' => config('database.connections.mariadb')]);
    DB::connection('mariadb_second')->statement('SET innodb_lock_wait_timeout = 1');
});

afterEach(function () {
    DB::setDefaultConnection('mariadb');
    DB::purge('mariadb_second');
});

/**
 * Runs the call on the second connection and returns what ended it: `ok`, the first message of a ValidationException
 * at `identifier`, or the QueryException of a lock that did not come.
 */
function createOnSecondConnection(Closure $call): string|QueryException
{
    DB::setDefaultConnection('mariadb_second');

    try {
        $call();

        return 'ok';
    } catch (ValidationException $invalid) {
        return $invalid->errors()['identifier'][0];
    } catch (QueryException $exception) {
        return $exception;
    } finally {
        DB::setDefaultConnection('mariadb');
    }
}

function expectWaitingForTheOrganizationLock(string|QueryException $outcome): void
{
    expect($outcome)->toBeInstanceOf(QueryException::class);
    assert($outcome instanceof QueryException);
    expect($outcome->getMessage())->toContain('Lock wait timeout')
        ->and($outcome->getSql())->toStartWith('select * from `organization`')->toEndWith('for update');
}

it('makes a new project wait for a rename and then finds the old identifier taken', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);

    // connection 1: WEB becomes SITE, the transaction stays open
    DB::connection('mariadb')->beginTransaction();
    UpdateProject::run(actor($admin), $web, ['identifier' => 'SITE']);

    // connection 2: a new project WEB waits for the lock instead of checking against what it read before
    expectWaitingForTheOrganizationLock(createOnSecondConnection(fn () => CreateProject::run(actor($admin), ['name' => 'Andere', 'identifier' => 'WEB'])));

    DB::connection('mariadb')->commit();

    // once the rename is done, WEB is a former identifier and stays reserved
    expect(createOnSecondConnection(fn () => CreateProject::run(actor($admin), ['name' => 'Andere', 'identifier' => 'WEB'])))
        ->toBe(__('field.identifier.taken'))
        ->and(Project::query()->pluck('identifier')->all())->toBe(['SITE'])
        ->and(ProjectIdentifier::query()->pluck('identifier')->all())->toBe(['WEB']);
});

it('lets only one of two new projects with the same identifier through, without a server error', function () {
    $admin = User::factory()->admin()->create();

    DB::connection('mariadb')->beginTransaction();
    CreateProject::run(actor($admin), ['name' => 'Betrieb', 'identifier' => 'OPS']);

    expectWaitingForTheOrganizationLock(createOnSecondConnection(fn () => CreateProject::run(actor($admin), ['name' => 'Auch Betrieb', 'identifier' => 'ops'])));

    DB::connection('mariadb')->commit();

    expect(createOnSecondConnection(fn () => CreateProject::run(actor($admin), ['name' => 'Auch Betrieb', 'identifier' => 'ops'])))
        ->toBe(__('field.identifier.taken'))
        ->and(Project::query()->pluck('name')->all())->toBe(['Betrieb']);
});
