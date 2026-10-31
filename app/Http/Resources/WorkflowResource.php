<?php

namespace App\Http\Resources;

use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkflowTransition;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A workflow as `Workflow` of resources/js/types.ts: the states in order, the transitions as pairs of state ids by the
 * position of the state they start from, then of the one they lead to.
 *
 * @mixin Workflow
 */
final class WorkflowResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Workflow $workflow */
        $workflow = $this->resource;

        $positions = $workflow->states->pluck('position', 'id')->all();
        $transitions = array_values($workflow->transitions->map(
            fn (WorkflowTransition $transition) => [$transition->from_state_id, $transition->to_state_id],
        )->all());
        usort($transitions, fn (array $a, array $b) => [$positions[$a[0]], $positions[$a[1]]] <=> [$positions[$b[0]], $positions[$b[1]]]);

        return [
            'id' => $workflow->id,
            'name' => $workflow->name,
            'description' => $workflow->description,
            'is_default' => $workflow->is_default,
            'is_free' => $workflow->is_free,
            'initial_state_id' => $workflow->initial_state_id,
            'states' => $workflow->states->map(fn (WorkflowState $state) => [
                'id' => $state->id,
                'name' => $state->name,
                'icon' => $state->icon->value,
                'category' => $state->category->value,
                'position' => $state->position,
            ])->values()->all(),
            'transitions' => $transitions,
        ];
    }
}
