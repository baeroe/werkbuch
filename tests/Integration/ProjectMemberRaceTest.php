<?php

use App\Access\ProjectRole;
use App\Actions\Projects\CreateProject;
use App\Actions\Projects\JoinProject;
use App\Actions\Projects\RemoveMember;
use App\Actions\Projects\UpdateProject;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\User;
use Illuminate\Validation\ValidationException;
use Tests\Support\RaceConnections;

/*
 * Changes of the members of a project take the row of the project `lockForUpdate` and check under it (MemberInput::lock):
 * a removal and a new lead, or two joins of one account, run one after the other; so do two changes of the project. Two connections as in
 * ProjectIdentifierRaceTest: `mariadb` holds its transaction open like a request in progress, `mariadb_second` is the
 * other request and gives up waiting for a lock after one second.
 */

beforeEach(fn () => RaceConnections::setUp());

afterEach(fn () => RaceConnections::tearDown());

it('makes the removal of a new lead wait for the change of lead, and then refuses it', function () {
    $mara = User::factory()->create();
    $web = CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB']);
    $lene = memberOf($web, ProjectRole::Member);

    // connection 1: Lene becomes the lead, the transaction stays open
    RaceConnections::hold(fn () => UpdateProject::run(actor($mara), $web, ['lead_id' => $lene->id]));

    // connection 2: the removal of Lene waits instead of reading the old lead
    RaceConnections::expectLockWait(RaceConnections::second(fn () => RemoveMember::run(actor($mara), $web, $lene)), 'projects');

    RaceConnections::release();

    $outcome = RaceConnections::second(fn () => RemoveMember::run(actor($mara), $web, $lene));

    expect($outcome)->toBeInstanceOf(Problem::class)
        ->and($outcome instanceof Problem ? $outcome->reason : null)->toBe('lead_cannot_leave')
        ->and(eventsOf(EventType::ProjectMemberRemoved)->count())->toBe(0);
});

it('makes the change of lead wait for a removal and then finds the new lead gone', function () {
    $mara = User::factory()->create();
    $web = CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB']);
    $lene = memberOf($web, ProjectRole::Member);

    // connection 1: Lene is removed, the transaction stays open
    RaceConnections::hold(fn () => RemoveMember::run(actor($mara), $web, $lene));

    // connection 2: making Lene the lead waits instead of finding her a member
    RaceConnections::expectLockWait(RaceConnections::second(fn () => UpdateProject::run(actor($mara), $web, ['lead_id' => $lene->id])), 'projects');

    RaceConnections::release();

    $outcome = RaceConnections::second(fn () => UpdateProject::run(actor($mara), $web, ['lead_id' => $lene->id]));

    expect($outcome)->toBeInstanceOf(ValidationException::class)
        ->and($outcome instanceof ValidationException ? $outcome->errors() : null)->toBe(['lead_id' => [__('field.lead.not_member')]])
        ->and(Project::query()->sole()->lead_id)->toBe($mara->id);
});

it('makes a second change of the project wait for the first and records its own old values', function () {
    $mara = User::factory()->create();
    $web = CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB']);
    // read before the first change, as by the request that runs at the same time (on the default connection, whichever)
    $stale = Project::query()->findOrFail($web->id)->setConnection(null);

    // connection 1: the name changes, the transaction stays open
    RaceConnections::hold(fn () => UpdateProject::run(actor($mara), $web, ['name' => 'Seite']));

    // connection 2: the other change waits for the project instead of starting from what it read before
    RaceConnections::expectLockWait(RaceConnections::second(fn () => UpdateProject::run(actor($mara), $stale, ['name' => 'App'])), 'projects');

    RaceConnections::release();

    expect(RaceConnections::second(fn () => UpdateProject::run(actor($mara), $stale, ['name' => 'App'])))->toBeInstanceOf(Project::class)
        ->and(eventsOf(EventType::ProjectUpdated)->pluck('changes')->all())->toBe([
            ['name' => ['old' => 'Website', 'new' => 'Seite']],
            ['name' => ['old' => 'Seite', 'new' => 'App']],
        ]);
});

it('lets one of two joins of the same account through, without a server error', function () {
    $mara = User::factory()->create();
    $web = CreateProject::run(actor($mara), ['name' => 'Website', 'identifier' => 'WEB']);
    $lene = User::factory()->create();

    RaceConnections::hold(fn () => JoinProject::run(actor($lene), $web));

    RaceConnections::expectLockWait(RaceConnections::second(fn () => JoinProject::run(actor($lene), $web)), 'projects');

    RaceConnections::release();

    $outcome = RaceConnections::second(fn () => JoinProject::run(actor($lene), $web));

    expect($outcome)->toBeInstanceOf(Problem::class)
        ->and($outcome instanceof Problem ? $outcome->reason : null)->toBe('already_member')
        ->and(eventsOf(EventType::ProjectMemberAdded)->count())->toBe(1);
});
