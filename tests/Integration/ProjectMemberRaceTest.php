<?php

use App\Access\ProjectRole;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\JoinProject;
use App\Actions\Projects\RemoveMember;
use App\Actions\Projects\UpdateProject;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
 * Changes of the members of a project take the row of the project `lockForUpdate` and check under it (MemberInput::lock):
 * a removal and a new lead, or two joins of one account, run one after the other. Two connections as in
 * ProjectIdentifierRaceTest: `mariadb` holds its transaction open like a request in progress, `mariadb_second` is the
 * other request and gives up waiting for a lock after one second.
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
 * Runs the call on the second connection and returns what ended it: `ok`, the Problem or the QueryException of a lock
 * that did not come.
 */
function memberCallOnSecondConnection(Closure $call): string|Problem|QueryException
{
    DB::setDefaultConnection('mariadb_second');

    try {
        $call();

        return 'ok';
    } catch (Problem|QueryException $exception) {
        return $exception;
    } finally {
        DB::setDefaultConnection('mariadb');
    }
}

function expectWaitingForTheProjectLock(string|Problem|QueryException $outcome): void
{
    expect($outcome)->toBeInstanceOf(QueryException::class);
    assert($outcome instanceof QueryException);
    expect($outcome->getMessage())->toContain('Lock wait timeout')
        ->and($outcome->getSql())->toStartWith('select * from `projects`')->toEndWith('for update');
}

it('makes the removal of a new lead wait for the change of lead, and then refuses it', function () {
    $mara = User::factory()->create();
    $web = CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB']);
    $lene = memberOf($web, ProjectRole::Member);

    // connection 1: Lene becomes the lead, the transaction stays open
    DB::connection('mariadb')->beginTransaction();
    UpdateProject::run(actor($mara), $web, ['lead_id' => $lene->id]);

    // connection 2: the removal of Lene waits instead of reading the old lead
    expectWaitingForTheProjectLock(memberCallOnSecondConnection(fn () => RemoveMember::run(actor($mara), $web, $lene)));

    DB::connection('mariadb')->commit();

    $outcome = memberCallOnSecondConnection(fn () => RemoveMember::run(actor($mara), $web, $lene));

    expect($outcome)->toBeInstanceOf(Problem::class)
        ->and($outcome instanceof Problem ? $outcome->reason : null)->toBe('lead_cannot_leave')
        ->and(Event::query()->where('type', EventType::ProjectMemberRemoved)->count())->toBe(0);
});

it('makes the change of lead wait for a removal and then finds the new lead gone', function () {
    $mara = User::factory()->create();
    $web = CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB']);
    $lene = memberOf($web, ProjectRole::Member);

    // connection 1: Lene is removed, the transaction stays open
    DB::connection('mariadb')->beginTransaction();
    RemoveMember::run(actor($mara), $web, $lene);

    // connection 2: making Lene the lead waits instead of finding her a member
    expectWaitingForTheProjectLock(memberCallOnSecondConnection(fn () => UpdateProject::run(actor($mara), $web, ['lead_id' => $lene->id])));

    DB::connection('mariadb')->commit();

    expect(Project::query()->sole()->lead_id)->toBe($mara->id);
});

it('lets one of two joins of the same account through, without a server error', function () {
    $mara = User::factory()->create();
    $web = CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB']);
    $lene = User::factory()->create();

    DB::connection('mariadb')->beginTransaction();
    JoinProject::run(actor($lene), $web);

    expectWaitingForTheProjectLock(memberCallOnSecondConnection(fn () => JoinProject::run(actor($lene), $web)));

    DB::connection('mariadb')->commit();

    $outcome = memberCallOnSecondConnection(fn () => JoinProject::run(actor($lene), $web));

    expect($outcome)->toBeInstanceOf(Problem::class)
        ->and($outcome instanceof Problem ? $outcome->reason : null)->toBe('already_member')
        ->and(Event::query()->where('type', EventType::ProjectMemberAdded)->count())->toBe(1);
});
