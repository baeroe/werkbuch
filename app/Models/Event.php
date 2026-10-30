<?php

namespace App\Models;

use App\Events\EventType;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Support\Carbon;

/**
 * A domain event: what an actor did to a subject. History and outbox in one; only App\Events\EventRecorder writes it.
 *
 * @property string $id
 * @property EventType $type
 * @property string $actor_id
 * @property string $subject_type
 * @property string $subject_id
 * @property string|null $project_id
 * @property array<string, array{old: mixed, new: mixed}>|null $changes
 * @property array<string, mixed> $meta
 * @property Carbon $occurred_at
 * @property Carbon|null $dispatched_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['type', 'actor_id', 'subject_type', 'subject_id', 'project_id', 'changes', 'meta', 'occurred_at', 'dispatched_at'])]
final class Event extends Model
{
    use HasUlids;

    /**
     * With microseconds, for `occurred_at` (timestamp(6)); the other columns drop them.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * @return BelongsTo<User, $this>
     */
    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    /**
     * @return MorphTo<Model, $this>
     */
    public function subject(): MorphTo
    {
        return $this->morphTo();
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => EventType::class,
            'changes' => 'array',
            'meta' => 'array',
            'occurred_at' => 'datetime',
            'dispatched_at' => 'datetime',
        ];
    }
}
