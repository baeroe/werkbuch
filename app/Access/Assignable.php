<?php

namespace App\Access;

use App\Enums\AccountType;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\User;
use App\Support\MemberInput;
use Illuminate\Database\Eloquent\Builder;

/**
 * Who can take work in a project: be its assignee, be picked in a person property (spec 4.2, 4.8; `canTakeWork` of the
 * clickdummy). An active account that is a member of the project, or an active person who is an org admin; a bot only
 * as a member, the default bot too, although it is an org admin (P30). Membership is asked of the database, so a check
 * under the lock of the project sees what a change of members before it left.
 */
final class Assignable
{
    public static function check(User $user, Project $project): bool
    {
        if ($user->isDisabled()) {
            return false;
        }

        return MemberInput::isMember($project, $user) || ($user->isPerson() && Visibility::orgRole($user) === OrgRole::Admin);
    }

    /**
     * The IDs of those of the accounts who can take work in the project, by the rule of check(), with one query for the
     * memberships of all of them (mentions in a text, Phase 7).
     *
     * @param  iterable<User>  $users
     * @return list<string>
     */
    public static function among(iterable $users, Project $project): array
    {
        $active = collect($users)->reject(fn (User $user) => $user->isDisabled());
        if ($active->isEmpty()) {
            return [];
        }

        $members = ProjectMember::query()->where('project_id', $project->id)->whereIn('user_id', $active->map(fn (User $user) => $user->id)->all())->pluck('user_id')->all();

        return array_values($active
            ->filter(fn (User $user) => in_array($user->id, $members, true) || ($user->isPerson() && Visibility::orgRole($user) === OrgRole::Admin))
            ->map(fn (User $user) => $user->id)->all());
    }

    /**
     * The accounts who can take work in the project, by the rule of check(), as a query over `users` (who can be
     * mentioned in a text of the project, `GET /api/v1/mentions`): active members, and active persons who are org admins.
     *
     * @return Builder<User>
     */
    public static function query(Project $project): Builder
    {
        $admins = array_keys(array_filter(app(RoleIndex::class)->orgRoles(), fn (OrgRole $role) => $role === OrgRole::Admin));

        return User::query()->whereNull('users.disabled_at')->where(fn (Builder $query) => $query
            ->whereIn('users.id', ProjectMember::query()->select('user_id')->where('project_id', $project->id))
            ->orWhere(fn (Builder $query) => $query->where('users.type', AccountType::Person->value)->whereIn('users.id', $admins)));
    }
}
