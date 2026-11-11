<?php

namespace App\Jobs;

use App\Search\SearchIndexer;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Writes the search documents of the items of some projects (`null`: of all), or only of the items named, again on the
 * queue `search`, when a change elsewhere (a workflow, a label, an identifier) changes what many documents hold. At most
 * BLOCK items per job (Phase 15, Task 11b): the rest goes to a follow-up job, the items of projects from the last id
 * written on (`$after`), the items named with only the ids still to write. So no job of a big organisation runs for
 * minutes, and no follow-up carries the whole list again. A worker that dies between queuing the follow-up and finishing
 * runs the job again and queues a second, equal follow-up: written twice, nothing lost.
 */
final class ReindexWorkItems implements ShouldQueue
{
    use Queueable;

    /**
     * The most items one job writes: whole chunks of the indexer (SearchIndexer::CHUNK), as the limit works at the end of
     * a chunk.
     */
    public const BLOCK = 2_000;

    /**
     * Below `retry_after` of the queue connection (90 s), so the queue never hands a job that still runs to another
     * worker; `queue:listen` in DDEV stops a job after 60 s anyway. A block takes well under a second.
     */
    public int $timeout = 60;

    /** @var list<string>|null `null`: every item of those projects */
    public ?array $itemIds = null;

    /** The items of projects after this id (a follow-up job). */
    public ?string $after = null;

    /**
     * The defaults stand on the properties, not in the constructor: a job queued before a property existed unserializes
     * with it at its default.
     *
     * @param  list<string>|null  $projectIds
     * @param  list<string>|null  $itemIds  `null`: every item of those projects
     */
    public function __construct(public ?array $projectIds, ?array $itemIds = null, ?string $after = null)
    {
        $this->itemIds = $itemIds;
        $this->after = $after;
        $this->onQueue('search');
    }

    public function handle(SearchIndexer $indexer): void
    {
        if ($this->itemIds !== null) {
            $indexer->reindexItems($this->projectIds, array_slice($this->itemIds, 0, self::BLOCK));
            $rest = array_slice($this->itemIds, self::BLOCK);
            if ($rest !== []) {
                self::dispatch($this->projectIds, $rest);
            }

            return;
        }

        $last = $indexer->reindexItems($this->projectIds, null, $this->after, self::BLOCK);
        if ($last !== null) {
            self::dispatch($this->projectIds, null, $last);
        }
    }
}
