<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Support\Actor;
use App\Support\ItemLock;
use App\Support\RelationSnapshot;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Removes a relation between two work items (spec 4.9). The relation is visible to whoever sees one of its ends (else
 * 404), and whoever may change one of the ends it sees (`update`) may remove it from there, also when the other end
 * lies in a project they may not change or not see (else the 403 of the first end they see). The locks of P1 for both
 * items (ItemLock::pair, an end deleted meanwhile: 404), then the relation `for update` (gone meanwhile: 404); an end
 * is writable only when neither its project nor the item itself is archived (spec 4.8): without one, the 409 of the
 * first end the account may change (`project_archived`, else `archived`). The other end is passive and may be archived.
 * Both items get a new `updated_at` and a `work_item.relation_removed` with `changes.relation = {old: RelationSnapshot,
 * new: null}` as each end reads it. The transaction runs up to three times (two item rows: a deadlock is retried).
 */
final class RemoveRelation
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, WorkItemRelation $relation): void
    {
        // both ends afresh: one deleted since the relation was bound took the relation with it
        $ends = WorkItem::query()->whereKey([$relation->source_id, $relation->target_id])->with('project')->get()->keyBy('id');
        $source = $ends->get($relation->source_id) ?? throw Problem::notFound();
        $target = $ends->get($relation->target_id) ?? throw Problem::notFound();

        $seen = array_values(array_filter(
            [$source, $target],
            fn (WorkItem $end) => Visibility::roleIn($actor->user, $end->project) !== null,
        ));
        if ($seen === []) {
            throw Problem::notFound();
        }

        $through = array_map(
            fn (WorkItem $end) => $end->id,
            array_filter($seen, fn (WorkItem $end) => Authorize::allows($actor, 'update', $end)),
        );
        if ($through === []) {
            Authorize::check($actor, 'update', $seen[0]);
        }

        DB::transaction(function () use ($actor, $relation, $source, $target, $through): void {
            // the end it does not work through may lie in a project in deletion (hidden, but still a relation of this one)
            [$source, $target] = ItemLock::pair($source, $target, array_values($through));
            $locked = WorkItemRelation::query()->lockForUpdate()->find($relation->id) ?? throw Problem::notFound();

            $editable = array_values(array_filter([$source, $target], fn (WorkItem $end) => in_array($end->id, $through, true)));
            $writable = array_filter($editable, fn (WorkItem $end) => $end->project->archived_at === null && $end->archived_at === null);
            if ($writable === []) {
                // the refusal of the end the account could edit otherwise, the project first (as every item action);
                // `$through` is never empty here, the check above refused that
                $first = $editable[0] ?? $source;
                throw $first->project->archived_at !== null
                    ? Problem::conflict('project_archived', [], __('problem.detail.project_archived'))
                    : Problem::conflict('archived', [], __('problem.detail.item_archived', ['key' => $first->key]));
            }

            $locked->load('type');
            $locked->delete();

            $now = $source->freshTimestamp();
            foreach ([$source, $target] as $end) {
                $end->updated_at = $now;
                $end->save();
                EventRecorder::record(EventType::WorkItemRelationRemoved, $actor, $end, $end->project, [
                    'relation' => ['old' => RelationSnapshot::of($locked, $end), 'new' => null],
                ]);
            }
        }, 3);
    }
}
