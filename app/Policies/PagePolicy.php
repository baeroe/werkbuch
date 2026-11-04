<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\Visibility;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Who may do what with the wiki of a project (spec 4.3, 4.15). Whoever sees the project reads its pages and versions
 * (viewers and outsiders of a public project too); a page of a project the account does not see, or of one being
 * deleted, is always a 404, never a 403. Writing (create, save, move, delete, restore a version) takes `wiki.edit`,
 * members and admins of the project. Called only through App\Access\Authorize::check().
 */
final class PagePolicy
{
    /** Reading the tree of the project. */
    public function viewAny(User $user, Project $project): Response
    {
        return Visibility::roleIn($user, $project) !== null ? Response::allow() : Response::denyAsNotFound();
    }

    public function view(User $user, Page $page): Response
    {
        return $this->viewAny($user, $page->project);
    }

    /** Creating a page in the project. */
    public function create(User $user, Project $project): Response
    {
        return self::edits($user, $project);
    }

    /** Saving, moving, deleting a page and restoring one of its versions. */
    public function update(User $user, Page $page): Response
    {
        return self::edits($user, $page->project);
    }

    private static function edits(User $user, Project $project): Response
    {
        if (Visibility::roleIn($user, $project) === null) {
            return Response::denyAsNotFound();
        }

        return Visibility::can($user, Permission::WikiEdit, $project) ? Response::allow() : Response::deny(__('problem.detail.wiki_members_only'));
    }
}
