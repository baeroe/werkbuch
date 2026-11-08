<?php

namespace App\Actions\WorkItems;

use App\Access\Authorize;
use App\Domain\Ranking\Rank;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\CatalogLock;
use App\Support\ItemLock;
use App\Support\ProjectLock;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Gives the items of a project new short ranks in their order (A448, changes A180): when the board finds no room
 * between two neighbours (a rank longer than ItemInput::RANK_MAX), it asks for this and tries again. Every item of the
 * project, archived ones too, keeps its place: the order is `rank` byte by byte, then the ULID, as the lists read it;
 * the new ranks are Rank::nBetween in that order. Only the rows whose rank changes are written, in one statement per
 * block: no `updated_at` and no event per item (the manual order is no history, A320), and one `project.ranks_redistributed`
 * for the project when anything changed. Across projects (a list of several projects sorted by hand) the mix of their
 * items may change; within a project never.
 *
 * Under the locks of a change of items in their order (P1): the organization shared, then the row of the project
 * `for update`. Every change of an item of the project shares that row (ItemLock::take): a `PATCH rank` waits until the
 * new ranks are committed, never lands in the middle of the rewrite. Where it lands depends on the neighbours its rank
 * was computed from: a rank computed after the redistribution falls between the new ones; a rank a client computed from
 * the old, long neighbours lands in the wrong place among the new, short ranks, and the server cannot tell. A client
 * loads the items again after this and only then computes a rank (the board does, Task 21e).
 *
 * The items are read in blocks over the index (`project_id`, `number`), never over `PRIMARY`: under REPEATABLE READ a
 * locking read keeps every row it scanned locked, and a scan of `PRIMARY` by ULID would hold the items of every other
 * project as well (and read the whole project again for every block).
 */
final class RedistributeRanks
{
    use AsAction;

    /** The items read and rewritten per statement. */
    public const BLOCK = 500;

    /**
     * @return int the number of items whose rank changed
     *
     * @throws Problem 404 for a project the account does not see (or one being deleted), 403 without `item.edit`, 409
     *                 `project_archived`
     */
    public function handle(Actor $actor, Project|string $project): int
    {
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;
        Authorize::check($actor, 'redistributeRanks', $project);

        return DB::transaction(function () use ($actor, $project): int {
            CatalogLock::share();
            $locked = ProjectLock::lock($project);
            ItemLock::refuseArchivedProject($locked);

            $rows = [];
            WorkItem::query()->where('project_id', $locked->id)->lockForUpdate()->select(['id', 'rank', 'number'])
                ->chunkById(self::BLOCK, function (Collection $items) use (&$rows): void {
                    foreach ($items as $item) {
                        $rows[] = ['id' => (string) $item->id, 'rank' => (string) $item->rank];
                    }
                }, 'number');

            // the manual order: the rank byte by byte (as `ascii_bin` compares), then the ULID (lower case)
            usort($rows, fn (array $a, array $b) => strcmp($a['rank'], $b['rank']) ?: strcmp($a['id'], $b['id']));

            $ranks = Rank::nBetween(null, null, count($rows));
            $changed = [];
            foreach ($rows as $position => $row) {
                if ($ranks[$position] !== $row['rank']) {
                    $changed[$row['id']] = $ranks[$position];
                }
            }

            foreach (array_chunk($changed, self::BLOCK, true) as $block) {
                self::write($block);
            }

            if ($changed !== []) {
                EventRecorder::record(EventType::ProjectRanksRedistributed, $actor, $locked, $locked, null, ['count' => count($changed)]);
            }

            return count($changed);
        }, 3);
    }

    /**
     * One statement for a block: `rank = case id when … then … end`, without `updated_at`. A statement of its own, with
     * bindings: an expression of the query builder's update takes none.
     *
     * @param  array<string, string>  $ranks  id => new rank
     */
    private static function write(array $ranks): void
    {
        $bindings = [];
        foreach ($ranks as $id => $rank) {
            array_push($bindings, $id, $rank);
        }

        DB::update(
            'update `work_items` set `rank` = case `id`'.str_repeat(' when ? then ?', count($ranks)).' end where `id` in ('.implode(', ', array_fill(0, count($ranks), '?')).')',
            [...$bindings, ...array_keys($ranks)],
        );
    }
}
