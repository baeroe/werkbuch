<?php

namespace App\Actions\Auth;

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\Accounts\NextHandle;
use App\Enums\AccountType;
use App\Enums\InvitationState;
use App\Enums\Locale;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Invitation;
use App\Models\Project;
use App\Models\User;
use App\Support\AccountInput;
use App\Support\Actor;
use App\Support\PasswordRules;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Accepts an invitation (spec 4.2): the invited person chooses a name and a password and gets an account with the
 * address, the role and the projects of the invitation. It runs before any sign-in, so the system acts for the new
 * account (A4, P18): `user.created` and one `project.member_added` per project, all with the reason `invitation`.
 * The invitation row is locked while it is checked, so two requests with the same link create one account.
 */
final class AcceptInvitation
{
    use AsAction;

    public function __construct(private readonly RoleAssignments $roles) {}

    /**
     * @param  array<string, mixed>  $input  `name`, `password`
     *
     * @throws ValidationException at `invitation` for a link that no longer works (also `null`, a replaced invitation
     *                             that is gone), at `name` and `password` for their rules; nothing is created then
     */
    public function handle(?Invitation $invitation, array $input): User
    {
        if (is_string($input['name'] ?? null)) {
            $input['name'] = trim($input['name']);
        }

        return DB::transaction(function () use ($invitation, $input): User {
            $locked = $invitation === null ? null : Invitation::query()->lockForUpdate()->find($invitation->id);

            $state = CheckInvitation::run($locked);

            if ($locked === null || $state !== InvitationState::Open) {
                throw ValidationException::withMessages(['invitation' => $state === InvitationState::Expired ? __('invitation.expired') : __('invitation.closed')]);
            }

            $valid = Validator::make($input, [
                'name' => ['required', 'string', 'max:'.AccountInput::NAME_MAX],
                'password' => PasswordRules::rules(),
            ], AccountInput::messages())->validate();

            $user = User::query()->create([
                'type' => AccountType::Person,
                'name' => $valid['name'],
                'handle' => NextHandle::run($valid['name']),
                'email' => $locked->email,
                'password' => $valid['password'],
                'locale' => Locale::tryFrom(app()->getLocale()),
            ]);

            $system = Actor::system($user, 'invitation');
            $this->roles->setOrgRole($user, $locked->org_role);
            EventRecorder::record(EventType::UserCreated, $system, $user, null);

            // projects that vanished or are being deleted since the invitation are skipped
            foreach ($locked->projects as $entry) {
                $project = Project::query()->whereNull('deleting_at')->find($entry['project_id']);

                if ($project === null) {
                    continue;
                }

                $role = ProjectRole::from($entry['role']);
                $this->roles->setProjectRole($user, $project, $role);
                EventRecorder::record(EventType::ProjectMemberAdded, $system, $project, $project, ['member' => ['old' => null, 'new' => ['user_id' => $user->id, 'role' => $role->value]]]);
            }

            $locked->update(['accepted_at' => now()]);

            return $user;
        });
    }
}
