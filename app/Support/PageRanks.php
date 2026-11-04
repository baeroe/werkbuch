<?php

namespace App\Support;

use App\Domain\Ranking\Rank;
use App\Models\Page;
use App\Models\Project;

/**
 * The ranks of the pages of a wiki, per row of siblings (byte by byte, `ascii_bin`). Only under PageLock::tree, which
 * keeps the row of siblings as it is read.
 */
final class PageRanks
{
    /** The rank after the last sibling below `$parentId` (`null`: the top level), `a0` for the first. */
    public static function append(Project $project, ?string $parentId): string
    {
        // MAX over the `ascii_bin` column compares byte by byte
        $last = Page::query()->where('project_id', $project->id)->where('parent_id', $parentId)->max('rank');

        return Rank::between(is_string($last) ? $last : null, null);
    }
}
