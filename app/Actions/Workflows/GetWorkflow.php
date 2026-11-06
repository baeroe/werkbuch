<?php

namespace App\Actions\Workflows;

use App\Models\Workflow;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One workflow with its states and transitions, as the list shows it. Every account reads it. The route binds it by
 * ULID in any case (A392).
 */
final class GetWorkflow
{
    use AsAction;

    public function handle(Actor $actor, Workflow $workflow): Workflow
    {
        return $workflow->load(['states', 'transitions']);
    }
}
