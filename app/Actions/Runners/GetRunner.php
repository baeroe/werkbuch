<?php

namespace App\Actions\Runners;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Runner;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One runner (org admins); a revoked one is 404.
 */
final class GetRunner
{
    use AsAction;

    /**
     * @throws Problem 403, 404
     */
    public function handle(Actor $actor, Runner $runner): Runner
    {
        Authorize::check($actor, 'manageRunners', Organization::class);

        if ($runner->revoked_at !== null) {
            throw Problem::notFound();
        }

        return $runner;
    }
}
