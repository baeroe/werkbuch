<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Brings an archived work item back (members and admins of the project, `item.edit`; spec 4.8): it is writable again
 * in the state it was archived in. An item that is not archived is a 409 `not_archived`. The locks of P1
 * (ItemLock::take); an archived project is read-only (409 `project_archived`).
 */
final class RestoreWorkItem
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, WorkItem $item): WorkItem
    {
        Authorize::check($actor, 'update', $item);

        $item = DB::transaction(function () use ($actor, $item): WorkItem {
            $locked = ItemLock::take($item);

            if ($locked->project->archived_at !== null) {
                throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
            }

            self::apply($actor, $locked);

            return $locked;
        });

        WorkItem::loadForResource($item, $actor->user);

        return $item;
    }

    /**
     * Restores an item the caller has locked (ItemLock) and may change: no right, no lock and no check of the project
     * here (BulkUpdateWorkItems checks those per item). An item that is not archived is a 409 `not_archived` naming
     * it; otherwise `archived_at` is cleared, `updated_at` is now and `work_item.restored` names `archived_at`.
     *
     * @return bool whether anything changed (always, when it does not throw)
     *
     * @throws Problem
     */
    public static function apply(Actor $actor, WorkItem $locked): bool
    {
        $previous = $locked->archived_at;
        if ($previous === null) {
            throw Problem::conflict('not_archived', [], __('problem.detail.not_archived', ['key' => $locked->key]));
        }

        $locked->archived_at = null;
        $locked->updated_at = $locked->freshTimestamp();
        $locked->save();

        EventRecorder::record(EventType::WorkItemRestored, $actor, $locked, $locked->project, [
            'archived_at' => ['old' => $previous->toJSON(), 'new' => null],
        ]);

        return true;
    }
}
