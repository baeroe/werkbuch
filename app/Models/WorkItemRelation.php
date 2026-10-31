<?php

namespace App\Models;

use Database\Factories\WorkItemRelationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A link of a relation type from one work item to another (spec 4.9): the source reads the outward label, the target
 * the inward one.
 *
 * @property string $id
 * @property string $type_id
 * @property string $source_id
 * @property string $target_id
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['type_id', 'source_id', 'target_id'])]
final class WorkItemRelation extends Model
{
    /** @use HasFactory<WorkItemRelationFactory> */
    use HasFactory, HasUlids;

    /**
     * @return BelongsTo<RelationType, $this>
     */
    public function type(): BelongsTo
    {
        return $this->belongsTo(RelationType::class, 'type_id');
    }

    /**
     * @return BelongsTo<WorkItem, $this>
     */
    public function source(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class, 'source_id');
    }

    /**
     * @return BelongsTo<WorkItem, $this>
     */
    public function target(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class, 'target_id');
    }
}
