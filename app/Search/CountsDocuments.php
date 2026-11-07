<?php

namespace App\Search;

/**
 * An engine that can describe the documents of an index (the first start asks, whether the indexes need an import).
 */
interface CountsDocuments
{
    /**
     * The documents of the index (with its prefix): how many there are, and in how many of them each field occurs.
     * An index that does not exist has none.
     *
     * @return array{documents: int, fields: array<string, int>}
     */
    public function documentStats(string $index): array;
}
