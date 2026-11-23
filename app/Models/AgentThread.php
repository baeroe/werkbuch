<?php

namespace App\Models;

use Database\Factories\AgentThreadFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * A strand (spec 5, 7.5): the work of an agent on one item or epic: runner, branch, worktree, session, PR. Its runs go to
 * its runner; after 30 minutes offline another one takes it over with a fresh session (spec 9).
 *
 * @property string $id
 * @property string $bot_id
 * @property string $project_id
 * @property string|null $work_item_id
 * @property string|null $runner_id
 * @property string|null $branch
 * @property string|null $base_branch
 * @property string|null $worktree
 * @property string|null $session_id
 * @property int|null $pr_number
 * @property string $status
 * @property string|null $pause_reason
 * @property int $corrections
 * @property int $conflicts
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read WorkItem|null $workItem
 * @property-read Runner|null $runner
 */
#[Fillable(['bot_id', 'project_id', 'work_item_id', 'runner_id', 'branch', 'base_branch', 'worktree', 'session_id', 'pr_number', 'status', 'pause_reason', 'corrections', 'conflicts'])]
final class AgentThread extends Model
{
    /** @use HasFactory<AgentThreadFactory> */
    use HasFactory, HasUlids;

    public const OPEN = 'open';

    public const PAUSED = 'paused';

    public const MERGED = 'merged';

    public const CLOSED = 'closed';

    public const STATUSES = [self::OPEN, self::PAUSED, self::MERGED, self::CLOSED];

    protected function casts(): array
    {
        return ['pr_number' => 'integer', 'corrections' => 'integer', 'conflicts' => 'integer'];
    }

    /** The branch of a strand of an item: `agent/<KEY>-<slug of the title>` (spec 7.6). */
    public static function branchFor(WorkItem $item): string
    {
        $slug = implode('-', array_slice(explode('-', Str::slug(Str::ascii($item->title))), 0, 5));

        return rtrim('agent/'.$item->key.'-'.$slug, '-');
    }

    /** @return BelongsTo<WorkItem, $this> */
    public function workItem(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class);
    }

    /** @return BelongsTo<Runner, $this> */
    public function runner(): BelongsTo
    {
        return $this->belongsTo(Runner::class);
    }
}
