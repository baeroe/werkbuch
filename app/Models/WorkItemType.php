<?php

namespace App\Models;

use App\Domain\Catalog\Tone;
use Database\Factories\WorkItemTypeFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A work item type of the organization (spec 4.6), such as Task, Bug or Epic, with the properties it asks for.
 *
 * @property string $id
 * @property string $name
 * @property string $icon
 * @property Tone $tone
 * @property string $description
 * @property bool $is_epic
 * @property Carbon|null $archived_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'icon', 'tone', 'description', 'is_epic', 'archived_at'])]
final class WorkItemType extends Model
{
    /** @use HasFactory<WorkItemTypeFactory> */
    use HasFactory, HasUlids;

    /**
     * @return HasMany<TypeProperty, $this>
     */
    public function typeProperties(): HasMany
    {
        return $this->hasMany(TypeProperty::class, 'type_id')->orderBy('position')->orderBy('id');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'tone' => Tone::class,
            'is_epic' => 'bool',
            'archived_at' => 'datetime',
        ];
    }
}
