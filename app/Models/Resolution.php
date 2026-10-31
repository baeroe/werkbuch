<?php

namespace App\Models;

use Database\Factories\ResolutionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A resolution an item gets when it is closed (spec 4.8). `default_for` marks the one a completed or a canceled item
 * gets without a choice.
 *
 * @property string $id
 * @property string $label
 * @property string|null $default_for
 * @property int $position
 * @property Carbon|null $archived_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['label', 'default_for', 'position', 'archived_at'])]
final class Resolution extends Model
{
    /** @use HasFactory<ResolutionFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'position' => 'int',
            'archived_at' => 'datetime',
        ];
    }
}
