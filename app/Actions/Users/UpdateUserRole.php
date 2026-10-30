<?php

namespace App\Actions\Users;

use App\Access\Authorize;
use App\Access\LastAdmin;
use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Sets the role of an account in the organization (org admins). The default bot always stays admin; the last active
 * admin among the people stays admin (LastAdmin, counted under a lock). The same role again changes nothing and
 * records nothing.
 */
final class UpdateUserRole
{
    use AsAction;

    public function __construct(private readonly RoleAssignments $roles) {}

    /**
     * @throws ValidationException at `org_role` for a role that does not exist
     * @throws Problem 409 `default_bot` or `last_admin`
     */
    public function handle(Actor $actor, User $user, OrgRole|string $role): User
    {
        Authorize::check($actor, 'changeRole', $user);

        $role = $role instanceof OrgRole ? $role
            : OrgRole::tryFrom($role) ?? throw ValidationException::withMessages(['org_role' => __('field.org_role.unknown')]);

        if ($user->is_default_bot) {
            throw Problem::conflict('default_bot', detail: __('problem.detail.default_bot_role'));
        }

        DB::transaction(function () use ($actor, $user, $role): void {
            if ($role === OrgRole::Admin) {
                Visibility::forget();
            } else {
                LastAdmin::guard($user);
            }

            $old = Visibility::orgRole($user);

            if ($old === $role) {
                return;
            }

            $this->roles->setOrgRole($user, $role);
            EventRecorder::record(EventType::UserRoleChanged, $actor, $user, null, ['org_role' => ['old' => $old->value, 'new' => $role->value]]);
        });

        return $user;
    }
}
