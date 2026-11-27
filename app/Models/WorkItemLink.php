<?php

namespace App\Models;

use App\Domain\GitHub\CiState;
use Database\Factories\WorkItemLinkFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A PR linked to an item (spec 12): one row per item, repo and number, the PR as the last webhook told it, whether it
 * closes the item on merge, the strand when an agent opened it (WEBU-26) and the verdict of its review. Its check runs on
 * the head commit are `checks`.
 *
 * @property string $id
 * @property string $work_item_id
 * @property string $kind
 * @property int $repository_github_id
 * @property string $repository
 * @property int $number
 * @property string $title
 * @property string $url
 * @property string $state
 * @property bool $draft
 * @property string $head_branch
 * @property string $base_branch
 * @property string $head_sha
 * @property Carbon|null $head_seen_at
 * @property string|null $checks_loaded_sha
 * @property Carbon|null $checks_loaded_at
 * @property bool $closes
 * @property string $author
 * @property string|null $thread_id
 * @property string|null $review
 * @property string|null $review_sha
 * @property Carbon|null $merged_at
 * @property Carbon|null $closed_at
 * @property Carbon|null $pr_updated_at
 * @property Carbon|null $merged_seen_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read WorkItem $workItem
 * @property-read Collection<int, WorkItemLinkCheck> $checks
 */
#[Fillable(['work_item_id', 'kind', 'repository_github_id', 'repository', 'number', 'title', 'url', 'state', 'draft', 'head_branch', 'base_branch', 'head_sha', 'head_seen_at', 'checks_loaded_sha', 'checks_loaded_at', 'closes', 'author', 'thread_id', 'review', 'review_sha', 'merged_at', 'closed_at', 'pr_updated_at', 'merged_seen_at'])]
final class WorkItemLink extends Model
{
    /** @use HasFactory<WorkItemLinkFactory> */
    use HasFactory, HasUlids;

    public const PULL_REQUEST = 'pull_request';

    public const OPEN = 'open';

    public const MERGED = 'merged';

    public const CLOSED = 'closed';

    protected function casts(): array
    {
        return [
            'repository_github_id' => 'integer', 'number' => 'integer', 'draft' => 'boolean', 'closes' => 'boolean',
            'merged_at' => 'datetime', 'closed_at' => 'datetime', 'pr_updated_at' => 'datetime', 'merged_seen_at' => 'datetime', 'head_seen_at' => 'datetime', 'checks_loaded_at' => 'datetime',
        ];
    }

    /** Whether the PR counts as open for the item: open, a draft too. */
    public function open(): bool
    {
        return $this->state === self::OPEN;
    }

    /** Open and ready: what moves an item to review (spec 12; a draft sets nothing off). */
    public function active(): bool
    {
        return $this->open() && ! $this->draft;
    }

    /** The CI state of the head commit (CiState), from the loaded checks. */
    public function ci(): string
    {
        return CiState::of(array_map(fn (WorkItemLinkCheck $check) => ['status' => $check->status, 'conclusion' => $check->conclusion], $this->headChecks()));
    }

    /**
     * The checks of the head commit, only the newest attempt of each (a job started again replaces the one before,
     * WEBU-62), in the order of `checks`.
     *
     * @return list<WorkItemLinkCheck>
     */
    public function headChecks(): array
    {
        $checks = $this->checks->where('head_sha', $this->head_sha)->values()->all();
        $kept = array_column(CiState::latest(array_map(fn (WorkItemLinkCheck $check, int $index) => [
            'kind' => $check->kind, 'app' => $check->app, 'name' => $check->name, 'id' => $check->check_run_id, 'index' => $index,
        ], $checks, array_keys($checks))), 'index');

        return array_map(fn (int $index) => $checks[$index], $kept);
    }

    /** @return BelongsTo<WorkItem, $this> */
    public function workItem(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class);
    }

    /** @return HasMany<WorkItemLinkCheck, $this> */
    public function checks(): HasMany
    {
        return $this->hasMany(WorkItemLinkCheck::class)->orderBy('name')->orderBy('id');
    }
}
