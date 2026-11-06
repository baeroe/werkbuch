<?php

namespace App\Actions\Resolutions;

use App\Models\Resolution;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One resolution, as the list shows it (archived ones too). Every account reads it. The route binds it by ULID in any
 * case (A392).
 */
final class GetResolution
{
    use AsAction;

    public function handle(Actor $actor, Resolution $resolution): Resolution
    {
        return $resolution;
    }
}
