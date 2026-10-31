<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\User;
use App\Support\Actor;
use App\Support\Ids;
use App\Support\MemberInput;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Adds an account to a project with a role (the admins of the project). Any active account may be added, a person or a
 * bot, the default bot too, but only when it is named: nobody becomes a member by accident. An account that is a member
 * already, does not exist or is deactivated is a 422 at `user_id`, a role that does not exist one at `role`.
 */
final class AddMember
{
    use AsAction;

    public function __construct(private readonly RoleAssignments $roles) {}

    /**
     * @param  array<string, mixed>  $input  `user_id`, `role`
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, Project $project, array $input): ProjectMember
    {
        Authorize::check($actor, 'manageMembers', $project);

        // ULIDs are stored in lower case; the collation would let an upper-case one pass `exists`
        if (array_key_exists('user_id', $input)) {
            $input['user_id'] = Ids::normalize($input['user_id']);
        }

        $member = DB::transaction(function () use ($actor, $project, $input): ProjectMember {
            $project = MemberInput::lock($project);

            $valid = Validator::make($input, [
                'user_id' => [
                    'bail', 'required', 'string', Rule::exists('users', 'id')->whereNull('disabled_at'),
                    function (string $attribute, string $value, Closure $fail) use ($project): void {
                        if (MemberInput::isMember($project, $value)) {
                            $fail(__('field.user.already_member'));
                        }
                    },
                ],
                'role' => ['required', 'string', Rule::enum(ProjectRole::class)],
            ], [
                'user_id.required' => __('field.user.inactive'),
                'user_id.string' => __('field.user.inactive'),
                'user_id.exists' => __('field.user.inactive'),
                'role.required' => __('field.project_role.unknown'),
                'role.string' => __('field.project_role.unknown'),
                'role.enum' => __('field.project_role.unknown'),
            ])->validate();

            $user = User::query()->findOrFail((string) $valid['user_id']);
            $role = ProjectRole::from((string) $valid['role']);

            $this->roles->setProjectRole($user, $project, $role);
            EventRecorder::record(EventType::ProjectMemberAdded, $actor, $project, $project, [
                'member' => ['old' => null, 'new' => ['user_id' => $user->id, 'role' => $role->value]],
            ]);

            return MemberInput::membership($project, $user);
        });

        // the new membership counts from the next check of this request on (P33)
        Visibility::forget();

        return $member;
    }
}
