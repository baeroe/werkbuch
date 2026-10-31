<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * An allowed move from one state of a workflow to another; a free workflow lists none.
 *
 * @property string $id
 * @property string $workflow_id
 * @property string $from_state_id
 * @property string $to_state_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['workflow_id', 'from_state_id', 'to_state_id'])]
final class WorkflowTransition extends Model
{
    use HasUlids;
}
