<?php

namespace App\Actions\AgentRuns;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One run, for who sees its project.
 */
final class GetRun
{
    use AsAction;

    /**
     * @throws Problem 404
     */
    public function handle(Actor $actor, AgentRun $run): AgentRun
    {
        Authorize::check($actor, 'view', $run);

        return $run->load('runner');
    }
}
