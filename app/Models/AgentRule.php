<?php

namespace App\Models;

use App\Domain\Agents\RunType;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * The working rules of the organization for a kind of run (spec 7.3, layer 2) where they differ from the standard
 * werkbuch ships; a kind without a row takes the standard in the language of the organization (AgentRules).
 *
 * @property string $id
 * @property RunType $type
 * @property string $body
 * @property string $updated_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['type', 'body', 'updated_by'])]
final class AgentRule extends Model
{
    use HasUlids;

    protected function casts(): array
    {
        return ['type' => RunType::class];
    }
}
