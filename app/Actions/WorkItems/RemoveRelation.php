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
 * items (ItemLock::pair), then the relation `for update` (gone meanwhile: 404); when every end the account may change
 * lies in an archived project, 409 `project_archived`. Both items get a new `updated_at` and a
 * `work_item.relation_removed` with `changes.relation = {old: RelationSnapshot, new: null}` as each end reads it. The
 * transaction runs up to three times (two item rows: a deadlock is retried).
 */
final class RemoveRelation
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, WorkItemRelation $relation): void
    {
        $relation->loadMissing(['source.project', 'target.project']);

        $seen = array_values(array_filter(
            [$relation->source, $relation->target],
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

        DB::transaction(function () use ($actor, $relation, $through): void {
            [$source, $target] = ItemLock::pair($relation->source, $relation->target);
            $locked = WorkItemRelation::query()->lockForUpdate()->find($relation->id) ?? throw Problem::notFound();

            $writable = array_filter([$source, $target], fn (WorkItem $end) => in_array($end->id, $through, true) && $end->project->archived_at === null);
            if ($writable === []) {
                throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
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
