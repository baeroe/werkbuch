<?php

namespace App\Access;

use App\Enums\ProjectVisibility;
use App\Models\Project;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * The one access scope (spec 4.3, master plan "Sichtbarkeit"): which projects an account sees and with which role.
 * Views, search, REST, MCP, relations, attachments, notifications and live channels build on it alone.
 *
 * - A disabled account sees nothing; a project being deleted (`deleting_at`) nobody.
 * - Org admins see every project and are admins in it, member or not.
 * - Everybody else sees the projects they are a member of and every public one; outside their projects they are viewers.
 * - Archived projects stay visible (whether they may change is up to the action).
 *
 * The answers are kept for the request in RoleIndex; forget() after changing projects or memberships (P33).
 */
final class Visibility
{
    /**
     * The ULIDs of the projects the account sees, archived ones included.
     *
     * @return Collection<int, string>
     */
    public static function projectIds(User $user): Collection
    {
        return self::index()->projectIds($user, function () use ($user): Collection {
            if ($user->isDisabled()) {
                return collect();
            }

            $query = Project::query()->whereNull('deleting_at');

            if (self::orgRole($user) !== OrgRole::Admin) {
                $memberOf = array_keys(self::index()->projectRoles($user));
                $query->where(fn (Builder $q) => $q->where('visibility', ProjectVisibility::Public)->orWhereIn('id', $memberOf));
            }

            return $query->orderBy('id')->pluck('id');
        });
    }

    /**
     * The role of the account in the project, or null when it does not see the project.
     */
    public static function roleIn(User $user, Project $project): ?ProjectRole
    {
        if ($user->isDisabled() || $project->deleting_at !== null) {
            return null;
        }

        if (self::orgRole($user) === OrgRole::Admin) {
            return ProjectRole::Admin;
        }

        return self::index()->projectRoles($user)[$project->id]
            ?? ($project->visibility === ProjectVisibility::Public ? ProjectRole::Viewer : null);
    }

    /**
     * The role in the organization; an account without an assignment is a member.
     */
    public static function orgRole(User $user): OrgRole
    {
        return self::index()->orgRoles()[$user->id] ?? OrgRole::Member;
    }

    /**
     * Whether the account is a member of the project (org admins see every project without being one).
     */
    public static function isMember(User $user, Project $project): bool
    {
        return array_key_exists($project->id, self::index()->projectRoles($user));
    }

    /**
     * Whether the account holds the right: a right of the organization through its org role, a right of a project
     * through its role in that project. A right of a project without a project is never held.
     */
    public static function can(User $user, Permission $permission, ?Project $project = null): bool
    {
        if ($permission->scope() === 'org') {
            return ! $user->isDisabled() && Grants::allows(self::orgRole($user), $permission);
        }

        $role = $project === null ? null : self::roleIn($user, $project);

        return $role !== null && Grants::allows($role, $permission);
    }

    public static function forget(): void
    {
        self::index()->forget();
    }

    private static function index(): RoleIndex
    {
        return app(RoleIndex::class);
    }
}
