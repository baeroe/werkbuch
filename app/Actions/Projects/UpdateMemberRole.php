<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Access\RoleAssignments;
use App\Access\RoleIndex;
use App\Access\Visibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\User;
use App\Support\Actor;
use App\Support\MemberInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Sets the role of a member of a project (the admins of the project). The lead may have any role: the lead has no
 * rights of its own (spec 4.3). The same role again changes nothing and records nothing.
 */
final class UpdateMemberRole
{
    use AsAction;

    public function __construct(private readonly RoleAssignments $roles) {}

    /**
     * @throws Problem 404 for an account that is no member
     * @throws ValidationException at `role` for a role that does not exist
     */
    public function handle(Actor $actor, Project $project, User $user, string $role): ProjectMember
    {
        Authorize::check($actor, 'manageMembers', $project);

        $member = DB::transaction(function () use ($actor, $project, $user, $role): ProjectMember {
            $project = MemberInput::lock($project);

            if (! MemberInput::isMember($project, $user)) {
                throw Problem::notFound();
            }

            $role = MemberInput::role($role);

            // the role as the database has it now, not as the request read it before the lock
            Visibility::forget();
            $old = app(RoleIndex::class)->members($project)[$user->id] ?? null;

            if ($old !== $role) {
                $this->roles->setProjectRole($user, $project, $role);
                EventRecorder::record(EventType::ProjectMemberRoleChanged, $actor, $project, $project, [
                    'member' => [
                        'old' => ['user_id' => $user->id, 'role' => $old?->value],
                        'new' => ['user_id' => $user->id, 'role' => $role->value],
                    ],
                ]);
            }

            return MemberInput::membership($project, $user);
        });

        Visibility::forget();

        return $member;
    }
}
