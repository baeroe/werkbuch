<?php

namespace Database\Factories;

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Enums\ProjectVisibility;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A project with the default workflow, every active type switched on and the first of them as the default type, as
 * CreateProject gives it without other wishes.
 *
 * @extends Factory<Project>
 */
class ProjectFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'identifier' => strtoupper(fake()->unique()->lexify('?????')),
            'name' => fake()->unique()->words(2, true),
            'description' => '',
            'lead_id' => User::factory(),
            'visibility' => ProjectVisibility::Public,
            'workflow_id' => fn () => Workflow::default()->id,
            'default_type_id' => fn () => self::activeTypes()[0],
            'next_number' => 0,
        ];
    }

    public function configure(): static
    {
        return $this->afterCreating(function (Project $project) {
            if (! $project->types()->exists()) {
                $project->types()->sync(self::activeTypes());
            }
        });
    }

    public function public(): static
    {
        return $this->state(fn (array $attributes) => ['visibility' => ProjectVisibility::Public]);
    }

    public function private(): static
    {
        return $this->state(fn (array $attributes) => ['visibility' => ProjectVisibility::Private]);
    }

    public function archived(): static
    {
        return $this->state(fn (array $attributes) => ['archived_at' => now()]);
    }

    /**
     * With the account as a member in this role.
     */
    public function member(User $user, ProjectRole $role): static
    {
        return $this->afterCreating(fn (Project $project) => app(RoleAssignments::class)->setProjectRole($user, $project, $role));
    }

    public function identifier(string $identifier): static
    {
        return $this->state(fn (array $attributes) => ['identifier' => $identifier]);
    }

    /**
     * @return list<string>
     */
    private static function activeTypes(): array
    {
        /** @var list<string> $ids */
        $ids = WorkItemType::query()->whereNull('archived_at')->orderBy('id')->pluck('id')->all();

        return $ids;
    }
}
