<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Support\Actor;
use App\Support\AttachmentTexts;
use App\Support\ItemLock;
use App\Support\ReadCommitted;
use App\Support\RelationSnapshot;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a work item for good (admins of the project, `item.delete`; spec 4.8), leaving a trace with everybody it
 * touched (P12): each child loses its parent with a `work_item.updated` of its own (`changes.parent_id`, `meta.reason`
 * `parent_deleted`), the other end of each relation gets a new `updated_at` (a relation is a change of the item, spec
 * 4.14) and a `work_item.relation_removed` (`changes.relation.old` as RelationSnapshot reads it from that end, also in
 * another project). Values, labels, relations, subscriptions, comments and their reactions go with the item (cascade);
 * the attachments of the item and of its comments (pictures of their texts, files of the file list) go with their
 * files after the commit (AttachmentFiles, K12), except those another saved text of the project still names (copied,
 * A233): they become that text's (AttachmentTexts::handOverOrRemove, Ruling T13-I1). Its own events stay, with a last `work_item.deleted` naming its key
 * and title, and its assignee in `meta.assignee_id` (the webhook of a bot hears that its item is gone, K9; meta never
 * leaves the server).
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

        // the texts are read as they are now, after the lock on the attachments (N1, T13-M8)
        ReadCommitted::run(fn () => DB::transaction(function () use ($actor, $item): void {
            $locked = ItemLock::take($item);

            if ($locked->project->archived_at !== null) {
                throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
            }

            $children = WorkItem::query()->where('parent_id', $locked->id)->orderBy('id')->lockForUpdate()->get();
            $relations = self::relations($locked);

            $orphaned = $actor->withReason(self::PARENT_DELETED);
            foreach ($children as $child) {
                $child->parent_id = null;
                $child->updated_at = $child->freshTimestamp();
                $child->save();
                EventRecorder::record(EventType::WorkItemUpdated, $orphaned, $child, $locked->project, [
                    'parent_id' => ['old' => $locked->id, 'new' => null],
                ]);
            }

            $now = $locked->freshTimestamp();
            foreach ($relations as $relation) {
                $other = $relation->source_id === $locked->id ? $relation->target : $relation->source;
                $other->updated_at = $now;
                $other->save();
                EventRecorder::record(EventType::WorkItemRelationRemoved, $actor, $other, $other->project, [
                    'relation' => ['old' => RelationSnapshot::of($relation, $other), 'new' => null],
                ]);
            }

            self::removeAttachments($locked);

            $key = $locked->key;
            $locked->delete();

            EventRecorder::record(EventType::WorkItemDeleted, $actor, $locked, $locked->project, null, ['key' => $key, 'title' => $locked->title, 'assignee_id' => $locked->assignee_id]);
        }, 3));
    }

    /**
     * The attachments the item or one of its comments owns, `for update`, each owner kind through the index of the owner
     * (two queries instead of `or`, so the lock covers only these rows; no comment comes meanwhile, AddComment waits for
     * the item): those another text still names go over to it, the rest go now, their rows through the query builder
     * (the owner is polymorphic, no cascade takes them), their files after the commit. The comments of the item go with
     * it, so their texts do not count.
     */
    private static function removeAttachments(WorkItem $locked): void
    {
        $lock = fn (string $type, array $ids) => $ids === [] ? new Collection
            : Attachment::query()->where('attachable_type', $type)->whereIn('attachable_id', $ids)->orderBy('id')->lockForUpdate()->get();
        /** @var list<string> $comments */
        $comments = Comment::query()->where('work_item_id', $locked->id)->orderBy('id')->pluck('id')->all();
        $attachments = $lock($locked->getMorphClass(), [$locked->id])->merge($lock((new Comment)->getMorphClass(), $comments));

        if ($attachments->isNotEmpty()) {
            AttachmentTexts::handOverOrRemove($attachments, $locked->project_id, [$locked->id], $comments);
        }
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
