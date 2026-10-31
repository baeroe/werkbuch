<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Support\Actor;
use App\Support\MemberInput;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Joins a project with one click (spec 4.3): whoever sees it becomes a member, with the role Member. That is every
 * account for a public project and an org admin for a private one; for anybody else the project does not exist (404).
 * A member already gets a 409 that names the project.
 */
final class JoinProject
{
    use AsAction;

    public function __construct(private readonly RoleAssignments $roles) {}

    /**
     * @throws Problem 404, or 409 `already_member`
     */
    public function handle(Actor $actor, Project $project): ProjectMember
    {
        Authorize::check($actor, 'join', $project);

        $member = DB::transaction(function () use ($actor, $project): ProjectMember {
            $project = MemberInput::lock($project);

            if (MemberInput::isMember($project, $actor->user)) {
                throw Problem::conflict('already_member', detail: __('problem.detail.already_member', ['identifier' => $project->identifier]));
            }

            $this->roles->setProjectRole($actor->user, $project, ProjectRole::Member);
            EventRecorder::record(EventType::ProjectMemberAdded, $actor, $project, $project, [
                'member' => ['old' => null, 'new' => ['user_id' => $actor->user->id, 'role' => ProjectRole::Member->value]],
            ]);

            return MemberInput::membership($project, $actor->user);
        });

        // the new membership counts from the next check of this request on (P33)
        Visibility::forget();

        return $member;
    }
}
