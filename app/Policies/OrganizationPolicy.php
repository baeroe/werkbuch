<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\Visibility;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Who may change the organization (spec 4.1): org admins (`org.manage`). Every account sees it.
 */
final class OrganizationPolicy
{
    public function update(User $user): Response
    {
        return Visibility::can($user, Permission::OrgManage)
            ? Response::allow()
            : Response::deny(__('problem.detail.organization_admins_only'));
    }
}
