<?php

use App\Access\OrgRole;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\RoleIndex;
use App\Access\Visibility;
use App\Models\Organization;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Exceptions\RoleDoesNotExist;
use Spatie\Permission\Models\Role;

it('keeps the role of an account per team', function () {
    $user = User::factory()->create();
    [$web, $ops] = Project::factory()->count(2)->create();
    app(RoleAssignments::class)->setProjectRole($user, $web, ProjectRole::Admin);
    app(RoleAssignments::class)->setProjectRole($user, $ops, ProjectRole::Viewer);
    app(RoleAssignments::class)->setProjectRole($user, $web, ProjectRole::Member);

    expect(Visibility::roleIn($user, $web))->toBe(ProjectRole::Member)
        ->and(Visibility::roleIn($user, $ops))->toBe(ProjectRole::Viewer)
        ->and(Visibility::orgRole($user))->toBe(OrgRole::Member)
        ->and(getPermissionsTeamId())->toBeNull()
        ->and(ProjectMember::query()->where('user_id', $user->id)->count())->toBe(2);
});

it('removes membership and role from one project and keeps the others', function () {
    $user = User::factory()->create();
    [$web, $ops] = Project::factory()->count(2)->private()->create();
    app(RoleAssignments::class)->setProjectRole($user, $web, ProjectRole::Admin);
    app(RoleAssignments::class)->setProjectRole($user, $ops, ProjectRole::Viewer);

    app(RoleAssignments::class)->removeFromProject($user, $web);

    expect(app(RoleIndex::class)->projectRoles($user))->toBe([$ops->id => ProjectRole::Viewer])
        ->and(Visibility::roleIn($user, $web))->toBeNull()
        ->and(Visibility::isMember($user, $web))->toBeFalse()
        ->and(Visibility::isMember($user, $ops))->toBeTrue()
        ->and(Visibility::orgRole($user))->toBe(OrgRole::Member)
        ->and(ProjectMember::query()->where('user_id', $user->id)->pluck('project_id')->all())->toBe([$ops->id])
        ->and(DB::table('model_has_roles')->where('model_id', $user->id)->where('team_id', $web->id)->exists())->toBeFalse();
});

it('replaces the role in the organization', function () {
    $user = User::factory()->create();

    app(RoleAssignments::class)->setOrgRole($user, OrgRole::Admin);
    expect(Visibility::orgRole($user))->toBe(OrgRole::Admin);

    app(RoleAssignments::class)->setOrgRole($user, OrgRole::Member);
    expect(Visibility::orgRole($user))->toBe(OrgRole::Member)
        ->and(DB::table('model_has_roles')->where('model_id', $user->id)->where('team_id', Organization::current()->id)->count())->toBe(1);
});

it('lists the members of a project with their roles', function () {
    $project = Project::factory()->private()->create();
    $admin = memberOf($project, ProjectRole::Admin);
    $viewer = memberOf($project, ProjectRole::Viewer);
    User::factory()->admin()->create();

    $members = app(RoleIndex::class)->members($project);
    ksort($members);
    $expected = [$admin->id => ProjectRole::Admin, $viewer->id => ProjectRole::Viewer];
    ksort($expected);

    expect($members)->toBe($expected);
});

it('restores the previous team and leaves no membership when an assignment fails', function () {
    $user = User::factory()->create();
    $project = Project::factory()->create();
    Role::findByName('project-admin')->delete();
    setPermissionsTeamId('01jbx0000000000000000previous');

    expect(fn () => app(RoleAssignments::class)->setProjectRole($user, $project, ProjectRole::Admin))
        ->toThrow(RoleDoesNotExist::class);

    expect(getPermissionsTeamId())->toBe('01jbx0000000000000000previous')
        ->and(ProjectMember::query()->where('user_id', $user->id)->exists())->toBeFalse();
});

it('forgets the roles read inside a transaction that rolls back', function () {
    $user = User::factory()->create();
    $project = Project::factory()->private()->create();

    try {
        DB::transaction(function () use ($user, $project) {
            app(RoleAssignments::class)->setProjectRole($user, $project, ProjectRole::Admin);
            app(RoleAssignments::class)->setOrgRole($user, OrgRole::Admin);

            expect(Visibility::roleIn($user, $project))->toBe(ProjectRole::Admin)
                ->and(Visibility::orgRole($user))->toBe(OrgRole::Admin)
                ->and(Visibility::projectIds($user)->all())->toBe([$project->id]);

            throw new RuntimeException('roll back');
        });
    } catch (RuntimeException) {
        // the assignments are gone, and so must be what was read of them
    }

    expect(Visibility::orgRole($user))->toBe(OrgRole::Member)
        ->and(Visibility::roleIn($user, $project))->toBeNull()
        ->and(Visibility::projectIds($user)->all())->toBe([]);
});

it('takes the highest of several roles in one team, whatever the row order', function (array $order) {
    $user = User::factory()->create();
    $project = Project::factory()->private()->create();
    $roleId = fn (OrgRole|ProjectRole $role): int => (int) DB::table('roles')->where('name', $role->roleName())->value('id');
    DB::table('model_has_roles')->where('model_id', $user->id)->delete();

    foreach ($order as $role) {
        DB::table('model_has_roles')->insert([
            'role_id' => $roleId($role),
            'model_type' => 'user',
            'model_id' => $user->id,
            'team_id' => $role instanceof OrgRole ? Organization::current()->id : $project->id,
        ]);
    }
    Visibility::forget();

    expect(Visibility::orgRole($user))->toBe(OrgRole::Admin)
        ->and(app(RoleIndex::class)->projectRoles($user))->toBe([$project->id => ProjectRole::Admin])
        ->and(app(RoleIndex::class)->members($project))->toBe([$user->id => ProjectRole::Admin]);
})->with([
    'highest first' => [[OrgRole::Admin, OrgRole::Member, ProjectRole::Admin, ProjectRole::Viewer, ProjectRole::Member]],
    'highest last' => [[OrgRole::Member, OrgRole::Admin, ProjectRole::Viewer, ProjectRole::Member, ProjectRole::Admin]],
]);
