<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Relations\Pivot;

/**
 * A work item type switched on in a project. A pivot class of its own so that `sync()` gives each row a ULID.
 */
final class ProjectType extends Pivot
{
    use HasUlids;

    public $incrementing = false;

    protected $table = 'project_types';
}
