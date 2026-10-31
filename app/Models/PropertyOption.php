<?php

namespace App\Models;

use App\Domain\Catalog\Tone;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * An option of a dropdown property; an archived one stays on the items that have it but is not offered anymore.
 *
 * @property string $id
 * @property string $property_id
 * @property string $label
 * @property Tone $color
 * @property int $position
 * @property Carbon|null $archived_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['property_id', 'label', 'color', 'position', 'archived_at'])]
final class PropertyOption extends Model
{
    use HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'color' => Tone::class,
            'position' => 'int',
            'archived_at' => 'datetime',
        ];
    }
}
