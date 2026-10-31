<?php

namespace App\Models;

use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A state of a workflow; what it means is its category, whatever it is called.
 *
 * @property string $id
 * @property string $workflow_id
 * @property string $name
 * @property StateIcon $icon
 * @property StateCategory $category
 * @property int $position
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['workflow_id', 'name', 'icon', 'category', 'position'])]
final class WorkflowState extends Model
{
    use HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'icon' => StateIcon::class,
            'category' => StateCategory::class,
            'position' => 'int',
        ];
    }
}
