<?php

namespace App\Access;

use App\Models\Organization;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\User;
use Closure;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;

/**
 * The one place that assigns roles (P2): spatie filters the roles of an account by the current team, so every change
 * sets the team, assigns, and restores the previous team, also when the assignment fails. Only actions, seeders and
 * factories call it (ArchTest); reading goes through RoleIndex.
 */
final class RoleAssignments
{
    public function __construct(private readonly PermissionRegistrar $registrar, private readonly RoleIndex $index) {}

    public function setOrgRole(User $user, OrgRole $role): void
    {
        $this->inTeam(Organization::current()->id, $user, fn () => $user->syncRoles([$role->roleName()]));
    }

    /**
     * Makes the account a member of the project (if it is not yet) with this role.
     */
    public function setProjectRole(User $user, Project $project, ProjectRole $role): void
    {
        DB::transaction(function () use ($user, $project, $role) {
            ProjectMember::query()->firstOrCreate(['project_id' => $project->id, 'user_id' => $user->id]);
            $this->inTeam($project->id, $user, fn () => $user->syncRoles([$role->roleName()]));
        });
    }

    /**
     * Ends the membership in the project together with the role in it.
     */
    public function removeFromProject(User $user, Project $project): void
    {
        DB::transaction(function () use ($user, $project) {
            ProjectMember::query()->where('project_id', $project->id)->where('user_id', $user->id)->delete();
            $this->inTeam($project->id, $user, fn () => $user->syncRoles([]));
        });
    }

    /**
     * @param  Closure(): mixed  $assign
     */
    private function inTeam(string $team, User $user, Closure $assign): void
    {
        $previous = $this->registrar->getPermissionsTeamId();
        $this->registrar->setPermissionsTeamId($team);
        $user->unsetRelation('roles');

        try {
            $assign();
        } finally {
            $this->registrar->setPermissionsTeamId($previous);
            $user->unsetRelation('roles');
            $this->index->forget();
        }
    }
}
