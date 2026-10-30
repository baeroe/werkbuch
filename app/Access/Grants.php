<?php

namespace App\Access;

/**
 * Which role holds which right: the tables of spec 4.3, fixed in code. SyncRoles mirrors them into the tables of
 * spatie; checks read them here (P2).
 */
final class Grants
{
    /** @var array<string, list<Permission>> */
    public const ORG = [
        OrgRole::Admin->value => [
            Permission::OrgManage, Permission::OrgManageCatalog, Permission::ProjectSeeAll, Permission::ProjectJoin,
            Permission::ProjectCreate, Permission::ViewCreate, Permission::ViewManageAny, Permission::TokenOwn,
        ],
        OrgRole::Member->value => [
            Permission::ProjectJoin, Permission::ProjectCreate, Permission::ViewCreate, Permission::TokenOwn,
        ],
    ];

    /** @var array<string, list<Permission>> */
    public const PROJECT = [
        ProjectRole::Admin->value => [
            Permission::ProjectRead, Permission::ItemComment, Permission::ItemCreate, Permission::ItemEdit,
            Permission::WikiEdit, Permission::TemplateManage, Permission::ItemDelete, Permission::ProjectManage,
            Permission::ProjectArchive,
        ],
        ProjectRole::Member->value => [
            Permission::ProjectRead, Permission::ItemComment, Permission::ItemCreate, Permission::ItemEdit,
            Permission::WikiEdit, Permission::TemplateManage,
        ],
        ProjectRole::Viewer->value => [
            Permission::ProjectRead, Permission::ItemComment,
        ],
    ];

    public static function allows(OrgRole|ProjectRole $role, Permission $permission): bool
    {
        return in_array($permission, self::of($role), true);
    }

    /**
     * @return list<Permission>
     */
    public static function of(OrgRole|ProjectRole $role): array
    {
        return $role instanceof OrgRole ? self::ORG[$role->value] : self::PROJECT[$role->value];
    }
}
