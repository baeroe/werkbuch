<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * An account that watches a work item, and why (`created`, `assigned`, `manual`). Who stops watching keeps the row with
 * `unsubscribed_at`: the opt-out stays on record.
 *
 * @property string $id
 * @property string $work_item_id
 * @property string $user_id
 * @property string $reason
 * @property Carbon|null $unsubscribed_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['work_item_id', 'user_id', 'reason', 'unsubscribed_at'])]
final class WorkItemSubscriber extends Model
{
    use HasUlids;

    /**
     * @return BelongsTo<WorkItem, $this>
     */
    public function workItem(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'unsubscribed_at' => 'datetime',
        ];
    }
}
