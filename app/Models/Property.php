<?php

namespace App\Models;

use App\Domain\Properties\FieldType;
use Database\Factories\PropertyFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A custom property of the organization (spec 4.7). Its settings hold what the field type needs (`decimals`, `multiple`).
 *
 * @property string $id
 * @property string $key
 * @property string $label
 * @property FieldType $field_type
 * @property string $help
 * @property mixed $default_value
 * @property array<string, mixed> $settings
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['key', 'label', 'field_type', 'help', 'default_value', 'settings'])]
final class Property extends Model
{
    /** @use HasFactory<PropertyFactory> */
    use HasFactory, HasUlids;

    /**
     * @return HasMany<PropertyOption, $this>
     */
    public function options(): HasMany
    {
        return $this->hasMany(PropertyOption::class)->orderBy('position')->orderBy('id');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'field_type' => FieldType::class,
            'default_value' => 'json',
            'settings' => 'array',
        ];
    }
}
