<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Support\Actor;
use App\Support\ItemLock;
use App\Support\RelationSnapshot;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a work item for good (admins of the project, `item.delete`; spec 4.8), leaving a trace with everybody it
 * touched (P12): each child loses its parent with a `work_item.updated` of its own (`changes.parent_id`, `meta.reason`
 * `parent_deleted`), the other end of each relation gets a `work_item.relation_removed` (`changes.relation.old` as
 * RelationSnapshot reads it from that end, also in another project). Values, labels, relations and subscriptions go
 * with the item (cascade); its own events stay, with a last `work_item.deleted` naming its key and title.
 *
 * The locks of P1 (ItemLock::take), then the children `for update` and the relations of the item `for update` (each
 * end through its own index, so the lock covers only those rows): a second deletion of the other end of a relation
 * waits and finds the relation gone. An archived project is read-only (409 `project_archived`). The transaction runs
 * up to three times: locking the children after the item can meet a change of a child that waits for its parent.
 */
final class DeleteWorkItem
{
    use AsAction;

    /** The reason a child that lost its parent shows in its history. */
    public const PARENT_DELETED = 'parent_deleted';

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, WorkItem $item): void
    {
        Authorize::check($actor, 'delete', $item);

        DB::transaction(function () use ($actor, $item): void {
            $locked = ItemLock::take($item);

            if ($locked->project->archived_at !== null) {
                throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
            }

            $children = WorkItem::query()->where('parent_id', $locked->id)->orderBy('id')->lockForUpdate()->get();
            $relations = self::relations($locked);

            $orphaned = new Actor($actor->user, $actor->via, self::PARENT_DELETED, $actor->token);
            foreach ($children as $child) {
                $child->parent_id = null;
                $child->updated_at = $child->freshTimestamp();
                $child->save();
                EventRecorder::record(EventType::WorkItemUpdated, $orphaned, $child, $locked->project, [
                    'parent_id' => ['old' => $locked->id, 'new' => null],
                ]);
            }

            foreach ($relations as $relation) {
                $other = $relation->source_id === $locked->id ? $relation->target : $relation->source;
                EventRecorder::record(EventType::WorkItemRelationRemoved, $actor, $other, $other->project, [
                    'relation' => ['old' => RelationSnapshot::of($relation, $other), 'new' => null],
                ]);
            }

            $key = $locked->key;
            $locked->delete();

            EventRecorder::record(EventType::WorkItemDeleted, $actor, $locked, $locked->project, null, ['key' => $key, 'title' => $locked->title]);
        }, 3);
    }

    /**
     * The relations at either end of the item, `for update`, in id order, with their types and both ends (with projects).
     *
     * @return Collection<int, WorkItemRelation>
     */
    private static function relations(WorkItem $locked): Collection
    {
        $lock = fn (string $end) => WorkItemRelation::query()->where($end, $locked->id)->lockForUpdate()->get();

        return $lock('source_id')->merge($lock('target_id'))->sortBy('id')->values()->load(['type', 'source.project', 'target.project']);
    }
}
