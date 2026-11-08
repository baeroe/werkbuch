<?php

namespace App\Models;

use App\Domain\Automations\AutomationKey;
use Database\Factories\AutomationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One of the five automations of a project (spec 4.13, AutomationKey), on or off, with its settings (`days`, the
 * `state_id` of Auto-Close). A project without a row for a key has that automation as its key starts
 * (AutomationKey::enabledByDefault(): off, but link_references) with its defaults.
 *
 * @property string $id
 * @property string $project_id
 * @property AutomationKey $key
 * @property bool $enabled
 * @property array<string, mixed> $settings
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Project $project
 */
#[Fillable(['project_id', 'key', 'enabled', 'settings'])]
final class Automation extends Model
{
    /** @use HasFactory<AutomationFactory> */
    use HasFactory, HasUlids;

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['key' => AutomationKey::class, 'enabled' => 'bool', 'settings' => 'array'];
    }
}
