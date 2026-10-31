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
use App\Models\User;
use App\Support\Actor;
use App\Support\MemberInput;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Removes a member from a project (the admins of the project); the account loses the project at once, unless it is public.
 * The lead stays (409 `lead_cannot_leave`): the lead must be a member (spec 4.3), so somebody else becomes lead first.
 */
final class RemoveMember
{
    use AsAction;

    public function __construct(private readonly RoleAssignments $roles) {}

    /**
     * @throws Problem 404 for an account that is no member, 409 `lead_cannot_leave`
     */
    public function handle(Actor $actor, Project $project, User $user): void
    {
        Authorize::check($actor, 'manageMembers', $project);

        DB::transaction(function () use ($actor, $project, $user): void {
            // the lead is read under the lock too: a change of lead at the same time waits for this removal
            $project = MemberInput::lock($project);

            if (! MemberInput::isMember($project, $user)) {
                throw Problem::notFound();
            }

            if ($project->lead_id === $user->id) {
                throw Problem::conflict('lead_cannot_leave');
            }

            // the role as the database has it now, not as the request read it before the lock
            Visibility::forget();
            $old = app(RoleIndex::class)->members($project)[$user->id] ?? null;

            $this->roles->removeFromProject($user, $project);
            EventRecorder::record(EventType::ProjectMemberRemoved, $actor, $project, $project, [
                'member' => ['old' => ['user_id' => $user->id, 'role' => $old?->value], 'new' => null],
            ]);
        });

        // the account no longer sees a private project, from the next check of this request on (P33)
        Visibility::forget();
    }
}
