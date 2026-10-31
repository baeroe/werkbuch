<?php

use App\Access\Grants;
use App\Access\OrgRole;
use App\Access\Permission;
use App\Access\ProjectRole;

// spec 4.3, row by row
it('grants the rights of the organization', function (OrgRole $role, Permission $permission, bool $expected) {
    expect(Grants::allows($role, $permission))->toBe($expected);
})->with([
    // Organisation, Personen, Bots, Webhooks verwalten
    [OrgRole::Admin, Permission::OrgManage, true], [OrgRole::Member, Permission::OrgManage, false],
    // Workflows, Typen, Properties, Labels, Relationstypen, Resolutions verwalten
    [OrgRole::Admin, Permission::OrgManageCatalog, true], [OrgRole::Member, Permission::OrgManageCatalog, false],
    // alle Projekte sehen und verwalten, auch private
    [OrgRole::Admin, Permission::ProjectSeeAll, true], [OrgRole::Member, Permission::ProjectSeeAll, false],
    // öffentliche Projekte sehen und beitreten
    [OrgRole::Admin, Permission::ProjectJoin, true], [OrgRole::Member, Permission::ProjectJoin, true],
    // Projekte anlegen
    [OrgRole::Admin, Permission::ProjectCreate, true], [OrgRole::Member, Permission::ProjectCreate, true],
    // Views anlegen
    [OrgRole::Admin, Permission::ViewCreate, true], [OrgRole::Member, Permission::ViewCreate, true],
    // fremde Views ändern und löschen
    [OrgRole::Admin, Permission::ViewManageAny, true], [OrgRole::Member, Permission::ViewManageAny, false],
    // eigene Tokens
    [OrgRole::Admin, Permission::TokenOwn, true], [OrgRole::Member, Permission::TokenOwn, true],
]);

it('lets every role of the organization join (ProjectPolicy::join has no refusal of its own)', function (OrgRole $role) {
    expect(Grants::allows($role, Permission::ProjectJoin))->toBeTrue();
})->with(OrgRole::cases());

it('grants the rights of a project', function (ProjectRole $role, Permission $permission, bool $expected) {
    expect(Grants::allows($role, $permission))->toBe($expected);
})->with([
    // Items, Wiki und Vorlagen lesen
    [ProjectRole::Admin, Permission::ProjectRead, true], [ProjectRole::Member, Permission::ProjectRead, true],
    [ProjectRole::Viewer, Permission::ProjectRead, true],
    // kommentieren, reagieren, beobachten
    [ProjectRole::Admin, Permission::ItemComment, true], [ProjectRole::Member, Permission::ItemComment, true],
    [ProjectRole::Viewer, Permission::ItemComment, true],
    // Items anlegen, ändern, archivieren
    [ProjectRole::Admin, Permission::ItemCreate, true], [ProjectRole::Member, Permission::ItemCreate, true],
    [ProjectRole::Viewer, Permission::ItemCreate, false],
    [ProjectRole::Admin, Permission::ItemEdit, true], [ProjectRole::Member, Permission::ItemEdit, true],
    [ProjectRole::Viewer, Permission::ItemEdit, false],
    // Wiki bearbeiten, Vorlagen und Zeitpläne verwalten
    [ProjectRole::Admin, Permission::WikiEdit, true], [ProjectRole::Member, Permission::WikiEdit, true],
    [ProjectRole::Viewer, Permission::WikiEdit, false],
    [ProjectRole::Admin, Permission::TemplateManage, true], [ProjectRole::Member, Permission::TemplateManage, true],
    [ProjectRole::Viewer, Permission::TemplateManage, false],
    // Items löschen
    [ProjectRole::Admin, Permission::ItemDelete, true], [ProjectRole::Member, Permission::ItemDelete, false],
    [ProjectRole::Viewer, Permission::ItemDelete, false],
    // Projekteinstellungen, Mitglieder, Workflow, Typen, Automatisierungen
    [ProjectRole::Admin, Permission::ProjectManage, true], [ProjectRole::Member, Permission::ProjectManage, false],
    [ProjectRole::Viewer, Permission::ProjectManage, false],
    // Projekt archivieren und löschen
    [ProjectRole::Admin, Permission::ProjectArchive, true], [ProjectRole::Member, Permission::ProjectArchive, false],
    [ProjectRole::Viewer, Permission::ProjectArchive, false],
]);

it('gives every right exactly one scope, held by the admin of that scope', function () {
    $org = array_map(fn (Permission $p) => $p->value, Grants::of(OrgRole::Admin));
    $project = array_map(fn (Permission $p) => $p->value, Grants::of(ProjectRole::Admin));

    expect(array_intersect($org, $project))->toBe([]);

    foreach (Permission::cases() as $permission) {
        expect($permission->scope())->toBeIn(['org', 'project'])
            ->and(in_array($permission->value, $permission->scope() === 'org' ? $org : $project, true))->toBeTrue();
    }

    expect(count($org) + count($project))->toBe(count(Permission::cases()));
});

it('gives every role only rights of its scope', function () {
    foreach (OrgRole::cases() as $role) {
        expect(array_map(fn (Permission $p) => $p->scope(), Grants::of($role)))->each->toBe('org');
    }

    foreach (ProjectRole::cases() as $role) {
        expect(array_map(fn (Permission $p) => $p->scope(), Grants::of($role)))->each->toBe('project');
    }
});

it('names the roles at spatie and reads them back', function () {
    expect(array_map(fn ($role) => $role->roleName(), [...OrgRole::cases(), ...ProjectRole::cases()]))
        ->toBe(['org-admin', 'org-member', 'project-admin', 'project-member', 'project-viewer']);

    foreach (OrgRole::cases() as $role) {
        expect(OrgRole::fromRoleName($role->roleName()))->toBe($role);
    }

    foreach (ProjectRole::cases() as $role) {
        expect(ProjectRole::fromRoleName($role->roleName()))->toBe($role);
    }

    expect(OrgRole::fromRoleName('project-admin'))->toBeNull()
        ->and(OrgRole::fromRoleName('org-viewer'))->toBeNull()
        ->and(OrgRole::fromRoleName('admin'))->toBeNull()
        ->and(ProjectRole::fromRoleName('org-admin'))->toBeNull()
        ->and(ProjectRole::fromRoleName('ghost'))->toBeNull();
});

it('ranks the project roles', function () {
    expect(ProjectRole::Viewer->rank())->toBe(0)
        ->and(ProjectRole::Member->rank())->toBe(1)
        ->and(ProjectRole::Admin->rank())->toBe(2);
});

it('ranks the org roles', function () {
    expect(OrgRole::Member->rank())->toBe(0)
        ->and(OrgRole::Admin->rank())->toBe(1);
});
