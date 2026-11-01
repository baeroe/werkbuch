<?php

namespace App\Access;

use App\Models\Project;
use App\Models\User;
use App\Support\MemberInput;

/**
 * Who can take work in a project: be its assignee, be picked in a person property (spec 4.2, 4.8; `canTakeWork` of the
 * clickdummy). An active account that is a member of the project, or an active person who is an org admin; a bot only
 * as a member, the default bot too, although it is an org admin (P30). Membership is asked of the database, so a check
 * under the lock of the project sees what a change of members before it left.
 */
final class Assignable
{
    public static function check(User $user, Project $project): bool
    {
        if ($user->isDisabled()) {
            return false;
        }

        return MemberInput::isMember($project, $user) || ($user->isPerson() && Visibility::orgRole($user) === OrgRole::Admin);
    }
}
