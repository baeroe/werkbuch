<?php

namespace App\Actions\RelationTypes;

use App\Models\RelationType;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One relation type. Every account reads it. The route binds it by ULID in any case (A392).
 */
final class GetRelationType
{
    use AsAction;

    public function handle(Actor $actor, RelationType $relationType): RelationType
    {
        return $relationType;
    }
}
