<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A check run on the head commit of a linked PR (spec 12): name, app, status, conclusion, link. Only the runs of the
 * current head commit are kept; a push drops the others.
 *
 * @property string $id
 * @property string $work_item_link_id
 * @property string $kind
 * @property int $check_run_id
 * @property string $name
 * @property string|null $app
 * @property string $status
 * @property string|null $conclusion
 * @property string|null $url
 * @property string $head_sha
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['work_item_link_id', 'kind', 'check_run_id', 'name', 'app', 'status', 'conclusion', 'url', 'head_sha'])]
final class WorkItemLinkCheck extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return ['check_run_id' => 'integer'];
    }
}
