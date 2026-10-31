<?php

namespace App\Access;

/**
 * The fixed rights of werkbuch (spec 4.3). The values are the names the interface uses (`src/lib/permissions.ts`, P4);
 * which role holds which right stands in Grants, the database only mirrors it (SyncRoles).
 */
enum Permission: string
{
    // organization
    case OrgManage = 'org.manage';
    case OrgManageCatalog = 'org.manage_catalog';
    case ProjectSeeAll = 'project.see_all';
    case ProjectJoin = 'project.join';
    case ProjectCreate = 'project.create';
    case ViewCreate = 'view.create';
    case ViewManageAny = 'view.manage_any';
    case TokenOwn = 'token.own';

    // project
    case ProjectRead = 'project.read';
    case ItemComment = 'item.comment';
    case ItemCreate = 'item.create';
    case ItemEdit = 'item.edit';
    case WikiEdit = 'wiki.edit';
    case TemplateManage = 'template.manage';
    case ItemDelete = 'item.delete';
    case ProjectManage = 'project.manage';
    case ProjectArchive = 'project.archive';

    /**
     * Where the right is held: `org` (by the role in the organization) or `project` (by the role in a project).
     */
    public function scope(): string
    {
        return match ($this) {
            self::OrgManage, self::OrgManageCatalog, self::ProjectSeeAll, self::ProjectJoin, self::ProjectCreate,
            self::ViewCreate, self::ViewManageAny, self::TokenOwn => 'org',
            default => 'project',
        };
    }
}
