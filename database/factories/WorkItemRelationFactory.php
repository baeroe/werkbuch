<?php

namespace Database\Factories;

use App\Models\RelationType;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A relation of the built-in type `relates` between two new items of one project.
 *
 * @extends Factory<WorkItemRelation>
 */
class WorkItemRelationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'type_id' => fn () => RelationType::query()->where('built_in', 'relates')->value('id'),
            'source_id' => WorkItem::factory(),
            'target_id' => fn (array $attributes) => WorkItem::factory()->state([
                'project_id' => WorkItem::query()->whereKey($attributes['source_id'])->firstOrFail()->project_id,
            ]),
        ];
    }

    /** Of the built-in type `blocks`: the source blocks the target. */
    public function blocks(): static
    {
        return $this->state(fn (array $attributes) => [
            'type_id' => fn () => RelationType::query()->where('built_in', 'blocks')->value('id'),
        ]);
    }
}
