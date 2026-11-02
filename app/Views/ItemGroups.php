<?php

namespace App\Views;

use App\Domain\Views\GroupBy;

/**
 * The groups of a query (`POST /work-items/groups`): the grouping that holds (by status only while the matches share
 * one workflow, P14), the number of all matches (each once, also with labels) and the groups in display order.
 */
final readonly class ItemGroups
{
    /**
     * @param  list<GroupCount>  $groups
     */
    public function __construct(public GroupBy $groupBy, public int $total, public array $groups) {}
}
