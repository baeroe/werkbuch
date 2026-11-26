<?php

namespace App\Models;

use App\Domain\Workflow\AgentStep;
use App\Domain\Workflow\State;
use App\Domain\Workflow\TransitionGraph;
use Database\Factories\WorkflowFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A workflow of the organization (spec 4.5): states with a category, and the transitions between them. A free workflow
 * lets every state follow every other one.
 *
 * @property string $id
 * @property string $name
 * @property string $description
 * @property bool $is_default
 * @property bool $is_free
 * @property string|null $initial_state_id
 * @property array<string, mixed>|null $agent_states
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property Collection<int, WorkflowState> $states
 * @property Collection<int, WorkflowTransition> $transitions
 */
#[Fillable(['name', 'description', 'is_default', 'is_free', 'initial_state_id', 'agent_states'])]
final class Workflow extends Model
{
    /** @use HasFactory<WorkflowFactory> */
    use HasFactory, HasUlids;

    /**
     * The one workflow marked as the default of the organization.
     */
    public static function default(): self
    {
        return self::query()->where('is_default', true)->sole();
    }

    /**
     * The rules of this workflow, built from its states and transitions (loaded when they are not yet).
     */
    public function graph(): TransitionGraph
    {
        $states = array_values($this->states->map(fn (WorkflowState $state) => new State(
            $state->id, $state->name, $state->icon, $state->category, $state->position,
        ))->all());
        $transitions = array_values($this->transitions->map(
            fn (WorkflowTransition $transition) => [$transition->from_state_id, $transition->to_state_id],
        )->all());

        return new TransitionGraph($states, $transitions, $this->is_free, $this->initial_state_id);
    }

    /**
     * The state each step of the agents sets (spec 7.4): every step once, a state id or null.
     *
     * @return array{working: ?string, review: ?string, correction: ?string, merged: ?string, ready: ?string}
     */
    public function agentStates(): array
    {
        return AgentStep::read($this->agent_states);
    }

    /** The state a step of the agents sets, null when the workflow names none. */
    public function agentState(AgentStep $step): ?string
    {
        return $this->agentStates()[$step->value];
    }

    /** Whether the workflow names a state for every step: agents and PR links work only then (spec 7.4, 12). */
    public function agentStepsComplete(): bool
    {
        return AgentStep::complete($this->agentStates());
    }

    /**
     * @return HasMany<WorkflowState, $this>
     */
    public function states(): HasMany
    {
        return $this->hasMany(WorkflowState::class)->orderBy('position')->orderBy('id');
    }

    /**
     * @return HasMany<WorkflowTransition, $this>
     */
    public function transitions(): HasMany
    {
        return $this->hasMany(WorkflowTransition::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_default' => 'bool',
            'is_free' => 'bool',
            'agent_states' => 'array',
        ];
    }
}
