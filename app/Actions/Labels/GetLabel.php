<?php

namespace App\Actions\Labels;

use App\Models\Label;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One label. Every account reads it. The route binds it by ULID in any case (A392).
 */
final class GetLabel
{
    use AsAction;

    public function handle(Actor $actor, Label $label): Label
    {
        return $label;
    }
}
