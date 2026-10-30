<?php

namespace App\Access;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Closure;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Reads the role assignments from the tables of spatie (`model_has_roles` ⋈ `roles`), without the team context of
 * spatie, and keeps them for the request (bound `scoped`). It never writes; RoleAssignments forgets it after every
 * change. Visibility keeps its visible projects here too, so one forget() clears both.
 */
final class RoleIndex
{
    /** @var array<string, OrgRole>|null */
    private ?array $orgRoles = null;

    /** @var array<string, array<string, ProjectRole>> */
    private array $projectRoles = [];

    /** @var array<string, array<string, ProjectRole>> */
    private array $members = [];

    /** @var array<string, Collection<int, string>> */
    private array $projectIds = [];

    /**
     * The roles in the organization: account ULID → role, all accounts in one query.
     *
     * @return array<string, OrgRole>
     */
    public function orgRoles(): array
    {
        return $this->orgRoles ??= $this->highest(OrgRole::cases(), 'team_id', Organization::current()->id, 'model_id');
    }

    /**
     * The roles of an account in its projects: project ULID → role, one query per account.
     *
     * @return array<string, ProjectRole>
     */
    public function projectRoles(User $user): array
    {
        return $this->projectRoles[$user->id] ??= $this->projectRolesWhere('model_id', $user->id, 'team_id');
    }

    /**
     * The members of a project: account ULID → role.
     *
     * @return array<string, ProjectRole>
     */
    public function members(Project $project): array
    {
        return $this->members[$project->id] ??= $this->projectRolesWhere('team_id', $project->id, 'model_id');
    }

    /**
     * The visible projects of an account, computed once per request (Visibility::projectIds).
     *
     * @param  Closure(): Collection<int, string>  $compute
     * @return Collection<int, string>
     */
    public function projectIds(User $user, Closure $compute): Collection
    {
        return $this->projectIds[$user->id] ??= $compute();
    }

    public function forget(): void
    {
        $this->orgRoles = null;
        $this->projectRoles = [];
        $this->members = [];
        $this->projectIds = [];
    }

    /**
     * @return array<string, ProjectRole>
     */
    private function projectRolesWhere(string $column, string $value, string $key): array
    {
        return $this->highest(ProjectRole::cases(), $column, $value, $key);
    }

    /**
     * The assignments to the given roles where `model_has_roles.$column` is `$value`, keyed by `model_has_roles.$key`.
     * Holds an account several of them in one team (spatie does not prevent it), the highest counts, never the row order.
     *
     * @template TRole of OrgRole|ProjectRole
     *
     * @param  list<TRole>  $roles
     * @return array<string, TRole>
     */
    private function highest(array $roles, string $column, string $value, string $key): array
    {
        $byName = [];

        foreach ($roles as $role) {
            $byName[$role->roleName()] = $role;
        }

        $rows = DB::table('model_has_roles')
            ->join('roles', 'roles.id', '=', 'model_has_roles.role_id')
            ->where('model_has_roles.model_type', Relation::getMorphAlias(User::class))
            ->whereIn('roles.name', array_keys($byName))
            ->where("model_has_roles.{$column}", $value)
            ->get(['roles.name as role', "model_has_roles.{$key} as holder"]);

        $highest = [];

        foreach ($rows as $row) {
            $role = $byName[(string) $row->role];
            $held = $highest[(string) $row->holder] ?? null;

            if ($held === null || $role->rank() > $held->rank()) {
                $highest[(string) $row->holder] = $role;
            }
        }

        return $highest;
    }
}
