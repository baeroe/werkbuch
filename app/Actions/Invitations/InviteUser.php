<?php

namespace App\Actions\Invitations;

use App\Access\Authorize;
use App\Access\OrgRole;
use App\Access\ProjectRole;
use App\Access\Visibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use App\Notifications\InvitationNotification;
use App\Support\AccountInput;
use App\Support\Actor;
use App\Support\InvitationLinks;
use App\Support\MailSetup;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Invites an address to the organization (org admins): the role in the organization and optionally projects (visible to
 * the admin) with a role each. The invitation is valid for seven days; a new one for the same address replaces the
 * open one, whose link then closes (P7). An address that already has an account cannot be invited. When the instance
 * can send mail, the link goes out as a queued mail after the commit; otherwise the admin copies it.
 */
final class InviteUser
{
    use AsAction;

    /**
     * @param  array<string, mixed>  $input  `email`, `org_role`, `projects` (list of `{project_id, role}`)
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): Invitation
    {
        Authorize::check($actor, 'invite', User::class);

        if (is_string($input['email'] ?? null)) {
            $input['email'] = Str::lower(trim($input['email']));
        }

        $valid = Validator::make($input, [
            'email' => ['required', 'string', 'email', 'max:255', Rule::unique('users', 'email')],
            'org_role' => ['required', 'string', Rule::in(array_column(OrgRole::cases(), 'value'))],
            'projects' => ['nullable', 'array'],
            'projects.*.project_id' => ['required', 'string', Rule::in(Visibility::projectIds($actor->user)->all())],
            'projects.*.role' => ['required', 'string', Rule::in(array_column(ProjectRole::cases(), 'value'))],
        ], [
            ...AccountInput::messages(),
            'email.unique' => __('field.email.account_exists'),
            'org_role.required' => __('field.org_role.unknown'),
            'org_role.string' => __('field.org_role.unknown'),
            'org_role.in' => __('field.org_role.unknown'),
            'projects.array' => __('field.projects.invalid'),
            'projects.*.project_id.required' => __('field.projects.unknown'),
            'projects.*.project_id.string' => __('field.projects.unknown'),
            'projects.*.project_id.in' => __('field.projects.unknown'),
            'projects.*.role.required' => __('field.project_role.unknown'),
            'projects.*.role.string' => __('field.project_role.unknown'),
            'projects.*.role.in' => __('field.project_role.unknown'),
        ])->validate();

        $invitation = DB::transaction(function () use ($actor, $valid): Invitation {
            // the open invitation to this address goes: its link closes
            Invitation::query()->where('email', $valid['email'])->whereNull('accepted_at')->delete();

            $invitation = Invitation::query()->create([
                'email' => $valid['email'],
                'org_role' => $valid['org_role'],
                'projects' => array_map(
                    fn (array $entry): array => ['project_id' => $entry['project_id'], 'role' => $entry['role']],
                    $valid['projects'] ?? [],
                ),
                'invited_by' => $actor->user->id,
                'expires_at' => now()->addDays(Invitation::VALID_DAYS),
            ]);

            EventRecorder::record(EventType::UserInvited, $actor, $invitation, null, ['email' => ['old' => null, 'new' => $invitation->email]]);

            return $invitation;
        });

        if (MailSetup::configured()) {
            Notification::route('mail', $invitation->email)->notify(
                (new InvitationNotification(InvitationLinks::for($invitation), Organization::current()->name, $actor->user->name))
                    ->locale(Organization::current()->locale->value),
            );
        }

        return $invitation;
    }
}
