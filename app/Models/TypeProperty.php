<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A property a work item type asks for, in its place and required or not.
 *
 * @property string $id
 * @property string $type_id
 * @property string $property_id
 * @property bool $required
 * @property int $position
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['type_id', 'property_id', 'required', 'position'])]
final class TypeProperty extends Model
{
    use HasUlids;

    /**
     * @return BelongsTo<WorkItemType, $this>
     */
    public function type(): BelongsTo
    {
        return $this->belongsTo(WorkItemType::class, 'type_id');
    }

    /**
     * @return BelongsTo<Property, $this>
     */
    public function property(): BelongsTo
    {
        return $this->belongsTo(Property::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'required' => 'bool',
            'position' => 'int',
        ];
    }
}
