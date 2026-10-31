<?php

namespace Database\Factories;

use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Models\Workflow;
use App\Models\WorkflowTransition;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A free workflow with three states: Backlog, Doing and Done, the first one as the start.
 *
 * @extends Factory<Workflow>
 */
class WorkflowFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->unique()->words(3, true),
            'description' => '',
            'is_default' => false,
            'is_free' => true,
        ];
    }

    public function configure(): static
    {
        return $this->afterCreating(function (Workflow $workflow) {
            $states = [
                ['Backlog', StateIcon::Dashed, StateCategory::Backlog],
                ['Doing', StateIcon::Half, StateCategory::Started],
                ['Done', StateIcon::Check, StateCategory::Completed],
            ];

            foreach ($states as $position => [$name, $icon, $category]) {
                $state = $workflow->states()->create(['name' => $name, 'icon' => $icon, 'category' => $category, 'position' => $position]);

                if ($position === 0) {
                    $workflow->update(['initial_state_id' => $state->id]);
                }
            }
        });
    }

    /**
     * Not free: only the listed moves are allowed, as pairs of positions (0 Backlog, 1 Doing, 2 Done).
     *
     * @param  list<array{0: int, 1: int}>  $pairs
     */
    public function matrix(array $pairs): static
    {
        return $this->state(['is_free' => false])->afterCreating(function (Workflow $workflow) use ($pairs) {
            $ids = $workflow->states()->pluck('id')->all();

            foreach ($pairs as [$from, $to]) {
                WorkflowTransition::query()->create([
                    'workflow_id' => $workflow->id, 'from_state_id' => $ids[$from], 'to_state_id' => $ids[$to],
                ]);
            }
        });
    }
}
