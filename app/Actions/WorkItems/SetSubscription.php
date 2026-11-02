<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\Support\Actor;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Starts or stops watching a work item for the acting person (spec 4.10): every person who sees the item, viewers
 * included, also in an archived project and on an archived item (P21); bots watch nothing (403 `bots_dont_watch`).
 * Watching keeps a row with reason `manual`; stopping keeps the row (or creates one with reason `manual`) with `unsubscribed_at` as an
 * opt-out that only a new assignment lifts (UpdateWorkItem). Only a real change writes and records `work_item.subscribed` or
 * `work_item.unsubscribed` (neither with a webhook nor in the history, P13). The item is locked without the
 * organization (ItemLock::take with `$catalog` off): a subscription changes nothing a change of the catalogs could
 * take away.
 */
final class SetSubscription
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, WorkItem $item, bool $on): WorkItem
    {
        Authorize::check($actor, 'watch', $item);

        $item = DB::transaction(function () use ($actor, $item, $on): WorkItem {
            $locked = ItemLock::take($item, false);
            $row = WorkItemSubscriber::query()->where('work_item_id', $locked->id)->where('user_id', $actor->user->id)->first();

            if ($row !== null && ($row->unsubscribed_at === null) === $on) {
                return $locked;
            }

            // stopping without a row stores an opt-out too (A250): a later automatic subscription respects it
            WorkItemSubscriber::query()->updateOrCreate(
                ['work_item_id' => $locked->id, 'user_id' => $actor->user->id],
                $on ? ['reason' => 'manual', 'unsubscribed_at' => null] : ['unsubscribed_at' => now()] + ($row === null ? ['reason' => 'manual'] : []),
            );

            EventRecorder::record($on ? EventType::WorkItemSubscribed : EventType::WorkItemUnsubscribed, $actor, $locked, $locked->project);

            return $locked;
        });

        WorkItem::loadForResource($item, $actor->user);

        return $item;
    }
}
