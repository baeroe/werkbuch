<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Exceptions\Problem;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Collection;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The relations of a work item as one reader sees them (spec 4.9, P19), for everybody who sees the item. Each entry
 * names the relation, the item at the other end (loaded for WorkItemResource with the reader, K5), the direction from
 * this item (`outward`: it is the source, `inward`: the target) and whether the other end is hidden: an item of a
 * project the reader does not see is `other: null`, and RelationEntryResource blanks its id. Order: the type (catalog
 * order), then the key of the other end (identifier, then number), the hidden ones after the visible ones of their type
 * (by relation id: they have no key to show).
 *
 * @phpstan-type RelationEntry array{relation: WorkItemRelation, other: ?WorkItem, direction: 'outward'|'inward', hidden: bool}
 */
final class ListRelations
{
    use AsAction;

    /**
     * @return list<RelationEntry>
     *
     * @throws Problem 404 when the account does not see the item
     */
    public function handle(Actor $actor, WorkItem $item): array
    {
        Authorize::check($actor, 'view', $item);

        return self::of($item, $actor->user);
    }

    /**
     * The entries of the item for the reader, past any right (GetWorkItem with `include=relations` checked it).
     *
     * @return list<RelationEntry>
     */
    public static function of(WorkItem $item, User $reader): array
    {
        $relations = WorkItemRelation::query()
            ->where(fn ($query) => $query->where('source_id', $item->id)->orWhere('target_id', $item->id))
            ->get();

        return self::entries($item, $relations, $reader);
    }

    /**
     * The entry of one relation of the item, as the answer of AddRelation shows it.
     *
     * @return RelationEntry
     */
    public static function entry(WorkItemRelation $relation, WorkItem $item, User $reader): array
    {
        return self::entries($item, $relation->newCollection([$relation]), $reader)[0];
    }

    /**
     * @param  Collection<int, WorkItemRelation>  $relations  relations of the item
     * @return list<RelationEntry>
     */
    private static function entries(WorkItem $item, Collection $relations, User $reader): array
    {
        $otherId = fn (WorkItemRelation $relation) => $relation->source_id === $item->id ? $relation->target_id : $relation->source_id;

        $visible = Visibility::projectIds($reader)->all();
        $others = WorkItem::query()->whereKey($relations->map($otherId)->all())->with('project')->get()
            ->filter(fn (WorkItem $other) => in_array($other->project_id, $visible, true))->values();
        WorkItem::loadForResource($others, $reader);
        $others = $others->keyBy('id');

        $entries = [];
        foreach ($relations as $relation) {
            $other = $others->get($otherId($relation));
            $entries[] = [
                'relation' => $relation,
                'other' => $other,
                'direction' => $relation->source_id === $item->id ? 'outward' : 'inward',
                'hidden' => $other === null,
            ];
        }

        usort($entries, self::compare(...));

        return $entries;
    }

    /**
     * Type, the visible ends before the hidden ones, the identifier of the other end naturally (`A2` before `A10`, like
     * the sort by key and the parent groups, T21g-M2), its number, the relation.
     *
     * @param  RelationEntry  $a
     * @param  RelationEntry  $b
     */
    private static function compare(array $a, array $b): int
    {
        return [$a['relation']->type_id, $a['hidden']] <=> [$b['relation']->type_id, $b['hidden']]
            ?: strnatcasecmp(self::natural($a['other']->project->identifier ?? ''), self::natural($b['other']->project->identifier ?? ''))
            ?: [$a['other']->number ?? 0, $a['relation']->id] <=> [$b['other']->number ?? 0, $b['relation']->id];
    }

    /**
     * An identifier without the leading zeros of its numbers. `natural_sort_key()` of MariaDB ignores them (`A02` sorts
     * like `A2`, after `A1`), while `strnatcasecmp` reads a number with a leading zero like a fraction (`A02` before
     * `A1`); without them both order alike (A2-M1).
     */
    private static function natural(string $identifier): string
    {
        return (string) preg_replace('/(?<!\d)0+(?=\d)/', '', $identifier);
    }
}
