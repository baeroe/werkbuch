<?php

namespace App\Models;

use Database\Factories\RelationTypeFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A kind of link between two work items (spec 4.8). Without an inward label it reads the same from both sides; a
 * built-in one (`built_in`) is known to the application and cannot be deleted.
 *
 * @property string $id
 * @property string $name
 * @property string $outward_label
 * @property string|null $inward_label
 * @property string|null $built_in
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'outward_label', 'inward_label', 'built_in'])]
final class RelationType extends Model
{
    /** @use HasFactory<RelationTypeFactory> */
    use HasFactory, HasUlids;
}
