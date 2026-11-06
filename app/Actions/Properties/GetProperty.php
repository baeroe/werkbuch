<?php

namespace App\Actions\Properties;

use App\Models\Property;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One property with its options, as the list shows it. Every account reads it. The route binds it by ULID in any case
 * (A392).
 */
final class GetProperty
{
    use AsAction;

    public function handle(Actor $actor, Property $property): Property
    {
        return $property->load('options');
    }
}
