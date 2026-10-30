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
