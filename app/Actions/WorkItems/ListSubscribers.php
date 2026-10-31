<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Collection;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Who watches a work item (spec 4.10), for everybody who sees it: the accounts with a subscription that was not
 * switched off (`unsubscribed_at`), by name and id, with their avatars for UserResource.
 */
final class ListSubscribers
{
    use AsAction;

    /**
     * @return Collection<int, User>
     *
     * @throws Problem 404 when the account does not see the item
     */
    public function handle(Actor $actor, WorkItem $item): Collection
    {
        Authorize::check($actor, 'view', $item);

        return User::query()
            ->whereIn('id', $item->subscriptions()->whereNull('unsubscribed_at')->select('user_id'))
            ->with('media')
            ->orderBy('name')->orderBy('id')
            ->get();
    }
}
