<?php

namespace App\Support;

use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\WorkItem;

/**
 * The locks of a change of work items, in the order of P1: the organization shared (`CatalogLock::share()`), the
 * project shared, the item `for update`; two items (a relation) both projects and both items, each pair by id, so two
 * changes of the same pair never wait for each other crosswise. Callers stand in their own transaction; what they
 * check afterwards they check against the rows read here.
 */
final class ItemLock
{
    /**
     * The item afresh and under `lockForUpdate`, with its project afresh (shared) as `project`. Without `$catalog` it
     * leaves the organization alone (a subscription changes nothing a change of the catalogs could take away).
     *
     * @throws Problem 404 when the item is gone or its project is being deleted
     */
    public static function take(WorkItem $item, bool $catalog = true): WorkItem
    {
        if ($catalog) {
            CatalogLock::share();
        }

        $project = self::project($item->project_id);
        $locked = self::item($item->id);

        return $locked->setRelation('project', $project);
    }

    /**
     * Both items afresh and under `lockForUpdate`, each with its project, in the order of the arguments. `$acting`
     * names the items the action works through (default both): only their projects must not be in deletion; the other
     * end is passive and may lie in a project the purge has yet to remove (a relation to it can still be removed).
     *
     * @param  list<string>|null  $acting
     * @return array{0: WorkItem, 1: WorkItem}
     *
     * @throws Problem 404 when an item is gone or the project of an acting one is being deleted
     */
    public static function pair(WorkItem $a, WorkItem $b, ?array $acting = null): array
    {
        CatalogLock::share();

        $live = array_map(fn (WorkItem $item) => $item->project_id, array_filter([$a, $b], fn (WorkItem $item) => $acting === null || in_array($item->id, $acting, true)));
        $projects = [];
        foreach (self::sorted([$a->project_id, $b->project_id]) as $id) {
            $projects[$id] = self::project($id, in_array($id, $live, true));
        }

        $items = [];
        foreach (self::sorted([$a->id, $b->id]) as $id) {
            $items[$id] = self::item($id);
        }

        return [
            $items[$a->id]->setRelation('project', $projects[$items[$a->id]->project_id]),
            $items[$b->id]->setRelation('project', $projects[$items[$b->id]->project_id]),
        ];
    }

    private static function project(string $id, bool $live = true): Project
    {
        $project = Project::query()->sharedLock()->find($id);

        return $project !== null && ($project->deleting_at === null || ! $live) ? $project : throw Problem::notFound();
    }

    private static function item(string $id): WorkItem
    {
        return WorkItem::query()->lockForUpdate()->find($id) ?? throw Problem::notFound();
    }

    /**
     * @param  list<string>  $ids
     * @return list<string>
     */
    private static function sorted(array $ids): array
    {
        $ids = array_values(array_unique($ids));
        sort($ids, SORT_STRING);

        return $ids;
    }
}
