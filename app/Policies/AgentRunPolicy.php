<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\Visibility;
use App\Models\AgentRun;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Who reads and steers a run (spec 6.4, 10.1, 10.6): who sees its project reads it (a 404 for everybody else);
 * cancelling and starting it again is for who may change items of the project (the item page), and for org admins
 * (the runner page). A run without an item (a review of a PR nobody linked) is the org admins' alone.
 */
final class AgentRunPolicy
{
    public function view(User $user, AgentRun $run): Response
    {
        return Visibility::roleIn($user, $run->project) !== null ? Response::allow() : Response::denyAsNotFound();
    }

    public function steer(User $user, AgentRun $run): Response
    {
        $seen = $this->view($user, $run);

        if ($seen->denied()) {
            return $seen;
        }

        return Visibility::can($user, Permission::OrgManage) || ($run->work_item_id !== null && Visibility::can($user, Permission::ItemEdit, $run->project))
            ? Response::allow()
            : Response::deny(__('problem.detail.runs_editors_only'));
    }
}
