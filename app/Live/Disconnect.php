<?php

namespace App\Live;

use App\Access\Visibility;
use App\Enums\AccountType;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;

/**
 * Closes the live connections of people who lost access (A281): Reverb ends them, Echo connects again and authorizes
 * every channel anew through the policies, a lost `project.{id}` answers 403. Only a broadcaster with connections
 * does anything (Reverb, the RecordingBroadcaster of the tests, K4); failures as A284 (Broadcasts).
 */
final class Disconnect
{
    /**
     * @param  list<string>  $ids
     */
    public static function users(array $ids): void
    {
        if ($ids !== []) {
            Broadcasts::terminate($ids);
        }
    }

    /**
     * Whom the event takes access from: the removed member (`project.member_removed`), every active person who no longer
     * sees a project made private (no members, no org admins), an org admin who became a member (`user.role_changed`) and
     * a deactivated account. Access is read now (Visibility, afresh): who got it back meanwhile keeps the connection.
     *
     * @return list<string>
     */
    public static function lostAccess(Event $event): array
    {
        $changes = $event->changes;

        return match ($event->type) {
            EventType::ProjectMemberRemoved => is_string($member = data_get($changes, 'member.old.user_id')) ? [$member] : [],
            EventType::ProjectUpdated => data_get($changes, 'visibility') === ['old' => 'public', 'new' => 'private'] ? self::outsiders($event->subject_id) : [],
            EventType::UserRoleChanged => data_get($changes, 'org_role') === ['old' => 'admin', 'new' => 'member'] ? [$event->subject_id] : [],
            EventType::UserDeactivated => [$event->subject_id],
            default => [],
        };
    }

    /**
     * The active people who do not see the project (any more): one query for the people, the rest from Visibility.
     *
     * @return list<string>
     */
    private static function outsiders(string $projectId): array
    {
        $project = Project::query()->find($projectId);
        if ($project === null) {
            return [];
        }

        Visibility::forget();
        $people = User::query()->where('type', AccountType::Person)->whereNull('disabled_at')->orderBy('id')->get();
        $seeing = array_map(fn (User $user) => $user->id, Visibility::seeing($project, $people));

        return array_values(array_diff($people->modelKeys(), $seeing));
    }
}
