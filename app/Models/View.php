<?php

namespace App\Models;

use App\Domain\Filter\Filter;
use App\Domain\Filter\FilterSchema;
use App\Domain\Views\Display;
use App\Domain\Views\DisplaySchema;
use App\Views\CatalogProperties;
use Database\Factories\ViewFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A view of the team (spec 4.11): every account sees every view; its creator and org admins change it. `filter` and
 * `display` hold the normal form (`Filter::toArray()`, `Display::toArray()`); `filter()` and `display()` read them
 * leniently against the catalog of today, so a property that is gone meanwhile never breaks the view (P2).
 *
 * @property string $id
 * @property string $name
 * @property string $icon
 * @property array<string, mixed> $filter
 * @property array<string, mixed> $display
 * @property string $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $creator
 */
#[Fillable(['name', 'icon', 'filter', 'display', 'created_by'])]
final class View extends Model
{
    /** @use HasFactory<ViewFactory> */
    use HasFactory, HasUlids;

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** The stored filter as the engine reads it: a condition that no longer fits matches nothing. */
    public function filter(): Filter
    {
        return FilterSchema::read($this->filter, app(CatalogProperties::class));
    }

    /** The stored display as the lists read it: unknown fields drop out, what no longer fits reads as the plain list. */
    public function display(): Display
    {
        return DisplaySchema::read($this->display, app(CatalogProperties::class));
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'filter' => 'array',
            'display' => 'array',
        ];
    }
}
