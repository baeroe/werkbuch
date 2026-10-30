<?php

namespace App\Access;

use App\Enums\AccountType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * The last active admin among the people can neither be demoted nor deactivated (spec 4.3); bots, the default bot
 * among them, never count. Two admins who demote each other at the same time must not both succeed (P29): the check
 * counts afresh and under a lock, inside the transaction of the change, before anything else reads a role there.
 */
final class LastAdmin
{
    /**
     * Refuses when the account is the only active admin among the people. Call it first in the transaction that takes
     * the role away: the lock on the rows of the admins holds until that transaction ends, so a second change waits
     * and then counts what the first one left.
     *
     * @throws Problem 409 `last_admin`
     */
    public static function guard(User $user): void
    {
        // whatever the request read about roles before is no answer under the lock
        Visibility::forget();

        $admins = DB::table('users')
            ->join('model_has_roles', fn (JoinClause $join) => $join->on('model_has_roles.model_id', '=', 'users.id')
                ->where('model_has_roles.model_type', Relation::getMorphAlias(User::class))
                ->where('model_has_roles.team_id', Organization::current()->id))
            ->join('roles', 'roles.id', '=', 'model_has_roles.role_id')
            ->where('roles.name', OrgRole::Admin->roleName())
            ->where('users.type', AccountType::Person->value)
            ->whereNull('users.disabled_at')
            ->lockForUpdate()
            ->pluck('users.id')
            ->all();

        if (in_array($user->id, $admins, true) && array_diff($admins, [$user->id]) === []) {
            throw Problem::conflict('last_admin', detail: __('problem.detail.last_admin'));
        }
    }
}
