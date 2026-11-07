<?php

namespace App\Search;

/**
 * An engine that can say how many documents an index holds (the first start asks, whether the indexes need an import).
 */
interface CountsDocuments
{
    /** The number of documents in the index (with its prefix); `0` for an index that does not exist. */
    public function documentCount(string $index): int;
}
