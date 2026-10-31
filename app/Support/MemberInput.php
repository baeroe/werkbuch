<?php

namespace App\Support;

use App\Access\ProjectRole;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\User;
use Illuminate\Validation\ValidationException;

/**
 * What the actions on the members of a project share: the lock on the project row, the role of the input and the
 * member as the REST resource wants it.
 */
final class MemberInput
{
    /**
     * The project afresh and under `lockForUpdate`, for the transaction of a change of members: two changes at the same
     * time (two joins, a removal and a new lead) run one after the other and check what the first one left. A project
     * that is being deleted by now is gone.
     *
     * @throws Problem 404
     */
    public static function lock(Project $project): Project
    {
        $locked = Project::query()->lockForUpdate()->findOrFail($project->id);

        return $locked->deleting_at === null ? $locked : throw Problem::notFound();
    }

    /**
     * @throws ValidationException at `role`
     */
    public static function role(mixed $role): ProjectRole
    {
        return (is_string($role) ? ProjectRole::tryFrom($role) : null)
            ?? throw ValidationException::withMessages(['role' => __('field.project_role.unknown')]);
    }

    /**
     * Whether the account is a member of the project, asked of the database (never of the request's cache).
     */
    public static function isMember(Project $project, User|string $user): bool
    {
        return ProjectMember::query()->where('project_id', $project->id)->where('user_id', $user instanceof User ? $user->id : $user)->exists();
    }

    /**
     * The membership of the account in the project, as a model that knows its project (the resource reads the role).
     */
    public static function membership(Project $project, User $user): ProjectMember
    {
        return ProjectMember::query()->where('project_id', $project->id)->where('user_id', $user->id)->firstOrFail()
            ->setRelation('project', $project);
    }
}
