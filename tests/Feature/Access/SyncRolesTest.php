<?php

use App\Access\Grants;
use App\Access\OrgRole;
use App\Access\Permission;
use App\Access\ProjectRole;
use App\Actions\Setup\SyncRoles;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Permission as StoredPermission;
use Spatie\Permission\Models\Role;

/**
 * The roles in the database with the names of their rights, sorted.
 *
 * @return array<string, list<string>>
 */
function storedRoles(): array
{
    return Role::with('permissions')->get()
        ->mapWithKeys(fn (Role $role) => [$role->name => $role->permissions->pluck('name')->sort()->values()->all()])
        ->sortKeys()->all();
}

/**
 * The roles as Grants defines them, in the same shape.
 *
 * @return array<string, list<string>>
 */
function grantedRoles(): array
{
    return collect([...OrgRole::cases(), ...ProjectRole::cases()])
        ->mapWithKeys(fn (OrgRole|ProjectRole $role) => [
            $role->roleName() => collect(Grants::of($role))->map(fn (Permission $p) => $p->value)->sort()->values()->all(),
        ])
        ->sortKeys()->all();
}

it('mirrors the grants after the migrations', function () {
    expect(storedRoles())->toBe(grantedRoles())
        ->and(StoredPermission::query()->pluck('name')->sort()->values()->all())
        ->toBe(collect(Permission::cases())->map->value->sort()->values()->all())
        ->and(Role::query()->whereNotNull('team_id')->count())->toBe(0)
        ->and(Role::query()->where('guard_name', '!=', 'web')->count())->toBe(0)
        ->and(StoredPermission::query()->where('guard_name', '!=', 'web')->count())->toBe(0);
});

it('removes rights and roles that are no longer granted and restores the grants', function () {
    $stale = StoredPermission::query()->create(['name' => 'stale.right', 'guard_name' => 'web']);
    Role::query()->create(['name' => 'ghost', 'guard_name' => 'web']);
    Role::query()->create(['name' => 'org-admin', 'guard_name' => 'web', 'team_id' => strtolower((string) str()->ulid())]);
    StoredPermission::query()->create(['name' => 'org.manage', 'guard_name' => 'api']);
    $viewer = Role::findByName('project-viewer');
    $viewer->permissions()->sync([$stale->id, StoredPermission::findByName('item.delete')->id]);

    SyncRoles::run();

    expect(storedRoles())->toBe(grantedRoles())
        ->and(StoredPermission::query()->where('name', 'stale.right')->exists())->toBeFalse()
        ->and(Role::query()->where('name', 'ghost')->exists())->toBeFalse()
        ->and(Role::query()->count())->toBe(5)
        ->and(StoredPermission::query()->count())->toBe(count(Permission::cases()));
});

it('changes nothing when it runs again', function () {
    $snapshot = fn () => [
        DB::table('permissions')->orderBy('id')->get()->toArray(),
        DB::table('roles')->orderBy('id')->get()->toArray(),
        DB::table('role_has_permissions')->orderBy('role_id')->orderBy('permission_id')->get()->toArray(),
    ];
    $before = $snapshot();

    SyncRoles::run();
    SyncRoles::run();

    expect($snapshot())->toEqual($before);
});

it('syncs from the command', function () {
    Role::findByName('project-member')->permissions()->detach();

    $this->artisan('app:sync-roles')->expectsOutput('Roles and permissions are in sync.')->assertSuccessful();

    expect(storedRoles())->toBe(grantedRoles());
});
