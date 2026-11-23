<?php

namespace App\Actions\Runners;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\RunnerPairingCode;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A pairing code without its code: whether a runner redeemed it, and which (the dialog „Runner verbinden“ waits for it).
 */
final class GetPairingCode
{
    use AsAction;

    /**
     * @throws Problem 403
     */
    public function handle(Actor $actor, RunnerPairingCode $pairing): RunnerPairingCode
    {
        Authorize::check($actor, 'manageRunners', Organization::class);

        return $pairing;
    }
}
