<?php

namespace App\Actions\Setup;

use App\Access\Grants;
use App\Access\OrgRole;
use App\Access\Permission;
use App\Access\ProjectRole;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;
use Spatie\Permission\Models\Permission as StoredPermission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * Mirrors Grants into the tables of spatie (spec 4.3: rights fixed in code, roles synchronised by migration): every
 * right, the five global roles (guard `web`, `team_id` null) and their rights; whatever Grants no longer names goes.
 * Runs from the migration and from `app:sync-roles`; it does not touch the assignments of accounts.
 */
final class SyncRoles
{
    use AsAction;

    private const GUARD = 'web';

    public function handle(): void
    {
        DB::transaction(function () {
            $names = array_map(fn (Permission $p) => $p->value, Permission::cases());

            StoredPermission::query()
                ->where(fn ($q) => $q->whereNotIn('name', $names)->orWhere('guard_name', '!=', self::GUARD))
                ->delete();

            foreach ($names as $name) {
                StoredPermission::query()->firstOrCreate(['name' => $name, 'guard_name' => self::GUARD]);
            }

            $ids = StoredPermission::query()->pluck('id', 'name');

            $roles = [...OrgRole::cases(), ...ProjectRole::cases()];

            Role::query()
                ->where(fn ($q) => $q->whereNotIn('name', array_map(fn (OrgRole|ProjectRole $r) => $r->roleName(), $roles))
                    ->orWhere('guard_name', '!=', self::GUARD)
                    ->orWhereNotNull('team_id'))
                ->delete();

            foreach ($roles as $role) {
                Role::query()
                    ->firstOrCreate(['name' => $role->roleName(), 'guard_name' => self::GUARD, 'team_id' => null])
                    ->permissions()->sync($ids->only(array_map(fn (Permission $p) => $p->value, Grants::of($role)))->values()->all());
            }
        });

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
