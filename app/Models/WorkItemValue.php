<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One value of a property on a work item (P9): text and URL in `value_string`, a number in `value_number`, a day in
 * `value_date`, a switch in `value_bool`, a person in `value_user_id`, an option in `value_option_id`, rich text in
 * `value_json`. A multiple choice is several rows with `position` 0, 1, …
 *
 * @property string $id
 * @property string $work_item_id
 * @property string $property_id
 * @property int $position
 * @property string|null $value_string
 * @property float|null $value_number
 * @property Carbon|null $value_date
 * @property bool|null $value_bool
 * @property string|null $value_user_id
 * @property string|null $value_option_id
 * @property array<string, mixed>|null $value_json
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Property $property
 */
#[Fillable([
    'work_item_id', 'property_id', 'position', 'value_string', 'value_number', 'value_date', 'value_bool',
    'value_user_id', 'value_option_id', 'value_json',
])]
final class WorkItemValue extends Model
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
            'position' => 'int',
            'value_number' => 'float',
            'value_date' => 'date:Y-m-d',
            'value_bool' => 'bool',
            'value_json' => 'array',
        ];
    }
}
