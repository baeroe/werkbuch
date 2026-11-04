<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\Visibility;
use App\Models\Project;
use App\Models\Template;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Who may do what with the templates of a project (spec 4.3, 4.12). Whoever sees the project reads its templates and
 * their runs (viewers and outsiders of a public project too); a template of a project the account does not see, or of
 * one being deleted, is always a 404, never a 403. Managing them (create, save, delete, run by hand) takes
 * `template.manage`, members and admins of the project. Called only through App\Access\Authorize::check().
 */
final class TemplatePolicy
{
    /** Reading the templates of the project. */
    public function viewAny(User $user, Project $project): Response
    {
        return Visibility::roleIn($user, $project) !== null ? Response::allow() : Response::denyAsNotFound();
    }

    public function view(User $user, Template $template): Response
    {
        return $this->viewAny($user, $template->project);
    }

    /** Creating a template in the project. */
    public function create(User $user, Project $project): Response
    {
        return self::manages($user, $project);
    }

    /** Saving, deleting and running a template by hand. */
    public function update(User $user, Template $template): Response
    {
        return self::manages($user, $template->project);
    }

    private static function manages(User $user, Project $project): Response
    {
        if (Visibility::roleIn($user, $project) === null) {
            return Response::denyAsNotFound();
        }

        return Visibility::can($user, Permission::TemplateManage, $project) ? Response::allow() : Response::deny(__('problem.detail.templates_members_only'));
    }
}
