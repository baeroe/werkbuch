<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\Visibility;
use App\Models\Project;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Who may do what with a project (spec 4.3, 4.4). A project the account does not see is always a 404, never a 403
 * (`denyAsNotFound`); among those who see it, the role decides. An archived project stays manageable for its admins
 * (restore, settings), as in src/lib/permissions.ts.
 */
final class ProjectPolicy
{
    /** The list: everybody, it holds only what they see. */
    public function viewAny(User $user): Response
    {
        return Response::allow();
    }

    public function view(User $user, Project $project): Response
    {
        return Visibility::roleIn($user, $project) !== null ? Response::allow() : Response::denyAsNotFound();
    }

    public function create(User $user): Response
    {
        return Visibility::can($user, Permission::ProjectCreate) ? Response::allow() : Response::deny();
    }

    public function update(User $user, Project $project): Response
    {
        return self::inProject($user, $project, Permission::ProjectManage, __('problem.detail.project_settings_admins'));
    }

    public function archive(User $user, Project $project): Response
    {
        return self::inProject($user, $project, Permission::ProjectArchive, __('problem.detail.project_archive_admins'));
    }

    public function delete(User $user, Project $project): Response
    {
        return self::inProject($user, $project, Permission::ProjectArchive, __('problem.detail.project_delete_admins'));
    }

    private static function inProject(User $user, Project $project, Permission $permission, string $refusal): Response
    {
        if (Visibility::roleIn($user, $project) === null) {
            return Response::denyAsNotFound();
        }

        return Visibility::can($user, $permission, $project) ? Response::allow() : Response::deny($refusal);
    }
}
