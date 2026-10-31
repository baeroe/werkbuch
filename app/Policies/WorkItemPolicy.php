<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\Visibility;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Auth\Access\Response;

/**
 * Who may do what with a work item (spec 4.3, 4.4). An item of a project the account does not see is always a 404,
 * never a 403 (`denyAsNotFound`); among those who see it, the role in the project decides.
 */
final class WorkItemPolicy
{
    public function view(User $user, WorkItem $item): Response
    {
        return Visibility::roleIn($user, $item->project) !== null ? Response::allow() : Response::denyAsNotFound();
    }

    /** Creating an item in the project: `item.create`, members and admins of the project. */
    public function create(User $user, Project $project): Response
    {
        return self::inProject($user, $project, Permission::ItemCreate, __('problem.detail.items_members_only'));
    }

    /** Changing an item: `item.edit`, members and admins of the project. */
    public function update(User $user, WorkItem $item): Response
    {
        return self::inProject($user, $item->project, Permission::ItemEdit, __('problem.detail.items_members_only'));
    }

    /** Deleting an item: `item.delete`, the admins of the project. */
    public function delete(User $user, WorkItem $item): Response
    {
        return self::inProject($user, $item->project, Permission::ItemDelete, __('problem.detail.items_delete_admins_only'));
    }

    /** Watching an item: every person who sees it; bots get no notifications and watch nothing. */
    public function watch(User $user, WorkItem $item): Response
    {
        if (Visibility::roleIn($user, $item->project) === null) {
            return Response::denyAsNotFound();
        }

        return $user->isPerson() ? Response::allow() : Response::deny(__('problem.detail.bots_dont_watch'));
    }

    private static function inProject(User $user, Project $project, Permission $permission, string $refusal): Response
    {
        if (Visibility::roleIn($user, $project) === null) {
            return Response::denyAsNotFound();
        }

        return Visibility::can($user, $permission, $project) ? Response::allow() : Response::deny($refusal);
    }
}
