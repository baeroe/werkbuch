<?php

namespace App\Views;

use App\Models\WorkItem;

/**
 * One group of an item list or one column of a board (plan, table "Gruppen"): its key, the number of matching items
 * in it, and for a parent group the parent item (only one the reader sees).
 */
final readonly class GroupCount
{
    public function __construct(public string $key, public int $count, public ?WorkItem $item = null) {}
}
