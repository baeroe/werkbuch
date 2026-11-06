<?php

namespace App\Support;

use App\Access\Visibility;
use App\Models\Event;
use App\Models\RelationType;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Collection;

/**
 * The `changes` of events as one reader may see them (K5, P19), for the history of an item and for webhooks: a relation
 * event stores the other end by id (RelationSnapshot); the reader gets `{label, item_id, key}` with the current key
 * when they see the other end, else only `{label, hidden: true}` (also when it is deleted or its project is being
 * deleted), so no id, key or title of a hidden item leaves the server. The label is the one of the type as it is now,
 * in the stored direction; once the type is deleted, the one the event stored. The other ends and types of all events
 * come with one query each, none without relation events.
 */
final class RelationChanges
{
    /**
     * Sets `history_changes` of every event: its `changes`, with the relation ends resolved for the reader.
     *
     * @param  array<int, Event>  $events
     */
    public static function forReader(array $events, User $reader): void
    {
        $snapshots = [];
        foreach ($events as $event) {
            $event->history_changes = $event->changes;
            foreach ($event->changes['relation'] ?? [] as $snapshot) {
                if (is_array($snapshot)) {
                    $snapshots[] = $snapshot;
                }
            }
        }
        if ($snapshots === []) {
            return;
        }

        $others = WorkItem::query()->whereKey(array_unique(array_column($snapshots, 'item_id')))
            ->whereIn('project_id', Visibility::projectIds($reader)->all())
            ->with('project')->get()->keyBy('id');
        $types = RelationType::query()->whereKey(array_unique(array_column($snapshots, 'relation_type_id')))->get()->keyBy('id');

        foreach ($events as $event) {
            $relation = $event->changes['relation'] ?? null;
            if ($relation !== null) {
                $changes = $event->changes;
                // an end missing from an older or drifted snapshot reads as no end, never as an error
                $changes['relation'] = ['old' => self::end($relation['old'] ?? null, $others, $types), 'new' => self::end($relation['new'] ?? null, $others, $types)];
                $event->history_changes = $changes;
            }
        }
    }

    /**
     * One end of a relation event as the reader may see it.
     *
     * @param  array{relation_type_id: string, direction: 'outward'|'inward', label: string, item_id: string}|null  $snapshot
     * @param  Collection<string, WorkItem>  $others  the other ends the reader sees
     * @param  Collection<string, RelationType>  $types
     * @return array{label: string, item_id: string, key: string}|array{label: string, hidden: true}|null
     */
    private static function end(?array $snapshot, Collection $others, Collection $types): ?array
    {
        if ($snapshot === null) {
            return null;
        }

        $type = $types->get($snapshot['relation_type_id']);
        $label = match (true) {
            $type === null => $snapshot['label'],
            $snapshot['direction'] === 'outward' => $type->outward_label,
            default => $type->inward_label ?? $type->outward_label,
        };
        $other = $others->get($snapshot['item_id']);

        return $other === null ? ['label' => $label, 'hidden' => true] : ['label' => $label, 'item_id' => $other->id, 'key' => $other->key];
    }
}
