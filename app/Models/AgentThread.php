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
 * A strand (spec 5, 7.5): the work of an agent on one item or epic: runner, branch, worktree, session, PR. An epic
 * strand with `per_child` holds the branch and PR of the epic, each child has a strand of its own into it
 * (`parent_thread_id`, WEBU-71). Its runs go to
 * its runner; after 30 minutes offline another one takes it over with a fresh session (spec 9).
 *
 * @property string $id
 * @property string $bot_id
 * @property string $project_id
 * @property string|null $work_item_id
 * @property string|null $runner_id
 * @property int|null $repository_github_id
 * @property string|null $branch
 * @property string|null $base_branch
 * @property string|null $worktree
 * @property string|null $session_id
 * @property int|null $pr_number
 * @property string|null $head_sha
 * @property bool $pr_draft
 * @property string|null $review_sha
 * @property string|null $review_verdict
 * @property string|null $merge_sha
 * @property Carbon|null $awaiting_pr_since
 * @property Carbon|null $ready_requested_at
 * @property array{source: string, head: string, text: string}|null $pending_findings
 * @property string|null $pushed_sha
 * @property Carbon|null $pushed_at
 * @property string $status
 * @property string|null $pause_reason
 * @property int $corrections
 * @property int $conflicts
 * @property bool $per_child
 * @property string|null $parent_thread_id
 * @property string|null $epic_waiting
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Runner|null $runner
 */
#[Fillable(['bot_id', 'project_id', 'work_item_id', 'runner_id', 'repository_github_id', 'branch', 'base_branch', 'worktree', 'session_id', 'pr_number', 'head_sha', 'pr_draft', 'review_sha', 'review_verdict', 'merge_sha', 'awaiting_pr_since', 'ready_requested_at', 'pending_findings', 'pushed_sha', 'pushed_at', 'status', 'pause_reason', 'corrections', 'conflicts', 'per_child', 'parent_thread_id', 'epic_waiting'])]
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
        return ['repository_github_id' => 'integer', 'pr_number' => 'integer', 'pr_draft' => 'boolean', 'awaiting_pr_since' => 'datetime', 'ready_requested_at' => 'datetime', 'pending_findings' => 'array', 'pushed_at' => 'datetime', 'corrections' => 'integer', 'conflicts' => 'integer', 'per_child' => 'boolean'];
    }

    /** The branch of a strand of an item: `agent/<KEY>-<slug of the title>` (spec 7.6). */
    public static function branchFor(WorkItem $item): string
    {
        $slug = implode('-', array_slice(explode('-', Str::slug(Str::ascii($item->title))), 0, 5));

        return rtrim('agent/'.$item->key.'-'.$slug, '-');
    }

    /** A branch no earlier strand of the item has: `-2`, `-3` … after the name (an old strand may still hold its worktree). */
    public static function freshBranchFor(WorkItem $item): string
    {
        $base = self::branchFor($item);
        $taken = self::query()->where('work_item_id', $item->id)->pluck('branch')->all();
        for ($n = 2, $branch = $base; in_array($branch, $taken, true); $n++) {
            $branch = $base.'-'.$n;
        }

        return $branch;
    }

    /** @return BelongsTo<Runner, $this> */
    public function runner(): BelongsTo
    {
        return $this->belongsTo(Runner::class);
    }
}
