<?php

namespace App\Jobs;

use App\Search\SearchIndexer;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Writes the search documents of the items of some projects (`null`: of all) again on the queue `search`, when a change
 * elsewhere (a workflow, a label, an identifier) changes what many documents hold.
 */
final class ReindexWorkItems implements ShouldQueue
{
    use Queueable;

    /**
     * @param  list<string>|null  $projectIds
     */
    public function __construct(public ?array $projectIds)
    {
        $this->onQueue('search');
    }

    public function handle(SearchIndexer $indexer): void
    {
        $indexer->reindexItems($this->projectIds);
    }
}
