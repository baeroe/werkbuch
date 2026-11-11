<?php

namespace App\Search;

use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Database\Eloquent\Collection;

/**
 * An engine that can fill an index beside the one the search reads and swap the two (SearchIndexer::buildNext(),
 * swapIn()): a rebuild never leaves the search empty. Every index named here starts with `scout.prefix`; another
 * index on the same engine (another installation, another program) stays untouched (K14). With an empty prefix (the
 * app's default) the check lets every name through: there only SearchIndexer, which names nothing but its own indexes
 * and their `_next`, keeps other indexes safe.
 */
interface SwapsIndexes
{
    /**
     * Writes the documents of these models to `$index` instead of their own index.
     *
     * @param  Collection<int, covariant WorkItem|Page|Project|User>  $models  all of one class
     */
    public function updateIn(string $index, Collection $models): void;

    /** Swaps the documents and settings of the two indexes; `$a` is created first when it does not exist. */
    public function swap(string $a, string $b): void;

    /**
     * Deletes the index with its documents and settings; an index that does not exist is no error. With `$ifExists`
     * it asks first and leaves a missing index alone (no failed task on the engine), which misses an index whose
     * creation is still waiting: only for leftovers of an earlier run.
     */
    public function dropIndex(string $index, bool $ifExists = false): void;
}
