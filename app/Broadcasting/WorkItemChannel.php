<?php

namespace App\Broadcasting;

use App\Access\Authorize;
use App\Domain\Ulid;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;

/**
 * `work-item.{itemId}` (private, A280): comments and reactions of an item, for every active person who may view the
 * item (WorkItemPolicy::view).
 */
final class WorkItemChannel
{
    public function join(User $user, string $id): bool
    {
        if (! $user->isPerson() || preg_match(Ulid::PATTERN, $id) !== 1) {
            return false;
        }

        $item = WorkItem::query()->find($id);

        return $item instanceof WorkItem && Authorize::allows(Actor::system($user, 'live'), 'view', $item);
    }
}
