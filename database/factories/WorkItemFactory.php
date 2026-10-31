<?php

namespace Database\Factories;

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Domain\Ranking\Rank;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\Priority;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\Resolution;
use App\Models\User;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An open work item as a member would create it: the default type of the project, the initial state of its workflow,
 * the next number of the project and a rank after its last item. No events, no subscribers (those are the work of
 * App\Actions\WorkItems\CreateWorkItem).
 *
 * @extends Factory<WorkItem>
 */
class WorkItemFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'type_id' => fn (array $attributes) => self::project($attributes)->default_type_id,
            'title' => rtrim(fake()->sentence(4), '.'),
            'state_id' => fn (array $attributes) => self::initialState(self::project($attributes)),
            'priority' => Priority::None,
            'created_by' => fn (array $attributes) => self::member(self::project($attributes)),
        ];
    }

    /**
     * The number (`++next_number` of the project) and the rank (after the highest of the project), unless given.
     */
    public function configure(): static
    {
        return $this->afterMaking(function (WorkItem $item) {
            if ($item->getAttribute('number') === null) {
                $project = Project::query()->findOrFail($item->project_id);
                $project->increment('next_number');
                $item->number = $project->next_number;
            }

            if ($item->getAttribute('rank') === null) {
                $last = WorkItem::query()->where('project_id', $item->project_id)->max('rank');
                $item->rank = Rank::between(is_string($last) ? $last : null, null);
            }
        });
    }

    /**
     * In the first completed state of the workflow, closed now, with the default resolution for completed items.
     */
    public function closed(): static
    {
        return $this->state(fn (array $attributes) => [
            'state_id' => fn (array $attributes) => self::stateOf(self::project($attributes), fn ($states) => $states->where('category', StateCategory::Completed->value)),
            'closed_at' => now(),
            'resolution_id' => fn () => Resolution::query()->where('default_for', StateCategory::Completed->value)->value('id'),
        ]);
    }

    /** Closed and archived. */
    public function archived(): static
    {
        return $this->closed()->state(fn (array $attributes) => ['archived_at' => now()]);
    }

    /** Of an epic type switched on in the project (a new one when it has none). */
    public function epic(): static
    {
        return $this->state(fn (array $attributes) => [
            'type_id' => function (array $attributes) {
                $project = self::project($attributes);
                $type = $project->types()->where('is_epic', true)->value('work_item_types.id');
                if (is_string($type)) {
                    return $type;
                }

                $epic = WorkItemType::factory()->epic()->create();
                $project->types()->attach($epic->id);

                return $epic->id;
            },
        ]);
    }

    /** A child of the item, in its project. */
    public function childOf(WorkItem $parent): static
    {
        return $this->state(fn (array $attributes) => ['project_id' => $parent->project_id, 'parent_id' => $parent->id]);
    }

    /** In the state of that name of the workflow of the project. */
    public function inState(string $name): static
    {
        return $this->state(fn (array $attributes) => [
            'state_id' => fn (array $attributes) => self::stateOf(self::project($attributes), fn ($states) => $states->where('name', $name)),
        ]);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private static function project(array $attributes): Project
    {
        return Project::query()->with('workflow')->whereKey($attributes['project_id'])->firstOrFail();
    }

    private static function initialState(Project $project): string
    {
        return $project->workflow->initial_state_id ?? self::stateOf($project, fn ($states) => $states);
    }

    /**
     * @param  callable(Builder<WorkflowState>): mixed  $filter
     */
    private static function stateOf(Project $project, callable $filter): string
    {
        $query = WorkflowState::query()->where('workflow_id', $project->workflow_id)->orderBy('position')->orderBy('id');
        $filter($query);

        return $query->firstOrFail()->id;
    }

    /** The first member of the project; a new person as a member when it has none. */
    private static function member(Project $project): string
    {
        $member = ProjectMember::query()->where('project_id', $project->id)->orderBy('id')->value('user_id');
        if (is_string($member)) {
            return $member;
        }

        $user = User::factory()->create();
        app(RoleAssignments::class)->setProjectRole($user, $project, ProjectRole::Member);

        return $user->id;
    }
}
