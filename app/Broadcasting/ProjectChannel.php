<?php

namespace App\Broadcasting;

use App\Access\Authorize;
use App\Domain\Ulid;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;

/**
 * `project.{projectId}` (private, A280): the item and project events of a project, for every active person who reads
 * it (ProjectPolicy::view: member, public project, org admin; never a project being deleted). Echo asks again on every
 * reconnect, so a lost project answers 403 there (A281).
 */
final class ProjectChannel
{
    public function join(User $user, string $id): bool
    {
        if (! $user->isPerson() || preg_match(Ulid::PATTERN, $id) !== 1) {
            return false;
        }

        $project = Project::query()->find($id);

        return $project instanceof Project && Authorize::allows(Actor::system($user, 'live'), 'view', $project);
    }
}
