<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Relations\Pivot;

/**
 * A label on a work item. A pivot class of its own so that `sync()` gives each row a ULID.
 */
final class WorkItemLabel extends Pivot
{
    use HasUlids;

    public $incrementing = false;

    protected $table = 'work_item_labels';
}
