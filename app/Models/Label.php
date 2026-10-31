<?php

namespace App\Models;

use App\Domain\Catalog\Tone;
use Database\Factories\LabelFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A label of the organization (spec 4.8), shared by all projects.
 *
 * @property string $id
 * @property string $name
 * @property Tone $color
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'color'])]
final class Label extends Model
{
    /** @use HasFactory<LabelFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'color' => Tone::class,
        ];
    }
}
