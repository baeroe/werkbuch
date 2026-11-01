<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Archives a closed work item (members and admins of the project, `item.edit`; spec 4.8): only an item in a Completed
 * or Canceled state (409 `not_closed`); an archived item is read-only until RestoreWorkItem brings it back. The locks
 * of P1 (ItemLock::take); an archived project is read-only (409 `project_archived`).
 */
final class ArchiveWorkItem
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
     * Archives an item the caller has locked (ItemLock) and may change: no right, no lock and no check of the project
     * here (BulkUpdateWorkItems checks those per item). An open item is a 409 `not_closed`; an archived one stays as it
     * is (no event). Otherwise `archived_at` and `updated_at` are now and `work_item.archived` names `archived_at`.
     *
     * @return bool whether anything changed
     *
     * @throws Problem
     */
    public static function apply(Actor $actor, WorkItem $locked): bool
    {
        $state = WorkflowState::query()->findOrFail($locked->state_id);
        if (! $state->category->isClosed()) {
            throw Problem::conflict('not_closed', [], __('problem.detail.not_closed'));
        }
        if ($locked->archived_at !== null) {
            return false;
        }

        $now = $locked->freshTimestamp();
        $locked->archived_at = $now;
        $locked->updated_at = $now;
        $locked->save();

        EventRecorder::record(EventType::WorkItemArchived, $actor, $locked, $locked->project, [
            'archived_at' => ['old' => null, 'new' => $locked->archived_at->toJSON()],
        ]);

        return true;
    }
}
