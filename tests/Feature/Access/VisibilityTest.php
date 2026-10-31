<?php

use App\Access\OrgRole;
use App\Access\Permission;
use App\Access\ProjectRole;
use App\Access\RoleIndex;
use App\Access\Visibility;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;

// spec 4.3 "Sichtbarkeit": an org admin, a member of projects, an org member outside them and a disabled org admin,
// against a public, a private, an archived (public) project and one that is being deleted
beforeEach(function () {
    $member = User::factory()->create();

    $this->projects = [
        'public' => Project::factory()->public()->member($member, ProjectRole::Member)->create(),
        'private' => Project::factory()->private()->member($member, ProjectRole::Member)->create(),
        'archived' => Project::factory()->public()->archived()->create(),
        'deleting' => Project::factory()->public()->member($member, ProjectRole::Admin)->create(['deleting_at' => now()]),
    ];

    $this->accounts = [
        'admin' => User::factory()->admin()->create(),
        'member' => $member,
        'outsider' => User::factory()->create(),
        'disabled' => User::factory()->admin()->disabled()->create(),
    ];
});

it('gives each account its role in each project', function (string $account, string $project, ?ProjectRole $role) {
    expect(Visibility::roleIn($this->accounts[$account], $this->projects[$project]))->toBe($role);
})->with([
    ['admin', 'public', ProjectRole::Admin], ['admin', 'private', ProjectRole::Admin],
    ['admin', 'archived', ProjectRole::Admin], ['admin', 'deleting', null],
    ['member', 'public', ProjectRole::Member], ['member', 'private', ProjectRole::Member],
    ['member', 'archived', ProjectRole::Viewer], ['member', 'deleting', null],
    ['outsider', 'public', ProjectRole::Viewer], ['outsider', 'private', null],
    ['outsider', 'archived', ProjectRole::Viewer], ['outsider', 'deleting', null],
    ['disabled', 'public', null], ['disabled', 'private', null],
    ['disabled', 'archived', null], ['disabled', 'deleting', null],
]);

it('lists exactly the projects an account sees, and the scope agrees', function (string $account, array $projects) {
    $user = $this->accounts[$account];
    $expected = collect($projects)->map(fn (string $key) => $this->projects[$key]->id)->sort()->values()->all();

    expect(Visibility::projectIds($user)->sort()->values()->all())->toBe($expected)
        ->and(Project::query()->visibleTo($user)->pluck('id')->sort()->values()->all())->toBe($expected);
})->with([
    ['admin', ['public', 'private', 'archived']],
    ['member', ['public', 'private', 'archived']],
    ['outsider', ['public', 'archived']],
    ['disabled', []],
]);

it('reads the role in the organization, member without an assignment', function () {
    $user = $this->accounts['outsider'];
    DB::table('model_has_roles')->where('model_id', $user->id)->delete();
    Visibility::forget();

    expect(Visibility::orgRole($this->accounts['admin']))->toBe(OrgRole::Admin)
        ->and(Visibility::orgRole($this->accounts['member']))->toBe(OrgRole::Member)
        ->and(Visibility::orgRole($user))->toBe(OrgRole::Member);
});

it('knows who is a member', function () {
    expect(Visibility::isMember($this->accounts['member'], $this->projects['private']))->toBeTrue()
        ->and(Visibility::isMember($this->accounts['member'], $this->projects['archived']))->toBeFalse()
        ->and(Visibility::isMember($this->accounts['admin'], $this->projects['private']))->toBeFalse();
});

it('answers rights of the organization through the org role', function () {
    expect(Visibility::can($this->accounts['admin'], Permission::OrgManage))->toBeTrue()
        ->and(Visibility::can($this->accounts['outsider'], Permission::OrgManage))->toBeFalse()
        ->and(Visibility::can($this->accounts['outsider'], Permission::ProjectCreate))->toBeTrue()
        ->and(Visibility::can($this->accounts['disabled'], Permission::TokenOwn))->toBeFalse();
});

it('answers rights of a project through the role in it', function () {
    ['admin' => $admin, 'member' => $member, 'outsider' => $outsider, 'disabled' => $disabled] = $this->accounts;
    ['public' => $public, 'private' => $private, 'deleting' => $deleting] = $this->projects;

    expect(Visibility::can($outsider, Permission::ItemComment, $public))->toBeTrue()
        ->and(Visibility::can($outsider, Permission::ItemCreate, $public))->toBeFalse()
        ->and(Visibility::can($outsider, Permission::ProjectRead, $private))->toBeFalse()
        ->and(Visibility::can($member, Permission::ItemEdit, $private))->toBeTrue()
        ->and(Visibility::can($member, Permission::ItemDelete, $private))->toBeFalse()
        ->and(Visibility::can($member, Permission::ProjectRead, $deleting))->toBeFalse()
        ->and(Visibility::can($admin, Permission::ItemDelete, $private))->toBeTrue()
        ->and(Visibility::can($disabled, Permission::ProjectRead, $public))->toBeFalse()
        // a right of a project needs the project
        ->and(Visibility::can($admin, Permission::ProjectRead))->toBeFalse();
});

it('reads the project roles of an account with one query per request', function () {
    $member = $this->accounts['member'];
    Visibility::forget();
    Visibility::orgRole($member); // roleIn reads the org roles too, in a query of their own

    DB::enableQueryLog();
    app(RoleIndex::class)->projectRoles($member);
    $first = count(DB::getQueryLog());
    DB::flushQueryLog();
    app(RoleIndex::class)->projectRoles($member);
    Visibility::roleIn($member, $this->projects['private']);
    Visibility::isMember($member, $this->projects['public']);
    $second = count(DB::getQueryLog());
    DB::disableQueryLog();

    expect($first)->toBe(1)->and($second)->toBe(0);
});

it('reads all roles in the organization with one query and the visible projects once', function () {
    Visibility::forget();
    Visibility::orgRole($this->accounts['admin']); // the organization itself is already loaded

    DB::enableQueryLog();
    Visibility::forget();
    Visibility::orgRole($this->accounts['admin']);
    Visibility::orgRole($this->accounts['member']);
    Visibility::orgRole($this->accounts['outsider']);
    $orgRoles = count(DB::getQueryLog());
    DB::flushQueryLog();
    Visibility::projectIds($this->accounts['member']);
    $first = count(DB::getQueryLog());
    DB::flushQueryLog();
    Visibility::projectIds($this->accounts['member']);
    $again = count(DB::getQueryLog());
    DB::disableQueryLog();

    expect($orgRoles)->toBe(1)->and($first)->toBe(2)->and($again)->toBe(0);
});

it('keeps the visible projects until it forgets them', function () {
    $outsider = $this->accounts['outsider'];
    Visibility::projectIds($outsider);
    $new = Project::factory()->public()->create(['lead_id' => $outsider->id]); // no new account, which would assign a role and forget

    expect(Visibility::projectIds($outsider)->contains($new->id))->toBeFalse();

    Visibility::forget();

    expect(Visibility::projectIds($outsider)->contains($new->id))->toBeTrue();
});
