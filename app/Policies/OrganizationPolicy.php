<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\Visibility;
use App\Enums\Catalog;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Who may change the organization (spec 4.1): org admins (`org.manage`). Every account sees it. The catalogs change with
 * `org.manage_catalog`, again org admins, and each refusal names its own catalog.
 */
final class OrganizationPolicy
{
    public function update(User $user): Response
    {
        return Visibility::can($user, Permission::OrgManage)
            ? Response::allow()
            : Response::deny(__('problem.detail.organization_admins_only'));
    }

    public function manageCatalog(User $user, Catalog $catalog): Response
    {
        return Visibility::can($user, Permission::OrgManageCatalog)
            ? Response::allow()
            : Response::deny($catalog->deniedDetail());
    }
}
