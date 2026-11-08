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
 * minutes, and no follow-up carries the whole list again.
 */
final class ReindexWorkItems implements ShouldQueue
{
    use Queueable;

    /** The most items one job writes. */
    public const BLOCK = 2_000;

    /** A block takes seconds; the limit only stops a job that hangs on Meilisearch. */
    public int $timeout = 600;

    /**
     * @param  list<string>|null  $projectIds
     * @param  list<string>|null  $itemIds  `null`: every item of those projects
     * @param  string|null  $after  the items of projects after this id (a follow-up job)
     */
    public function __construct(public ?array $projectIds, public ?array $itemIds = null, public ?string $after = null)
    {
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
