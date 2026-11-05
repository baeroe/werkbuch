<?php

namespace Database\Factories;

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Domain\Schedule\Schedule;
use App\Models\Organization;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\Template;
use App\Models\User;
use App\Support\TemplateSchedule;
use DateTimeZone;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A template of a new project: a Task (the default type of the project) titled „Wartung KW {week}“ without any other
 * field, created by the first member of the project, without a schedule; `scheduled()` gives it one that counts from
 * now. No events, no runs (those are the work of App\Actions\Templates).
 *
 * @extends Factory<Template>
 */
class TemplateFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'project_id' => Project::factory(),
            'name' => 'Wöchentliche Wartung',
            'payload' => fn (array $attributes) => [
                'type_id' => self::project($attributes['project_id'])->default_type_id,
                'title' => 'Wartung KW {week}',
                'description' => null,
                'priority' => 'none',
                'assignee_id' => null,
                'label_ids' => [],
                'values' => [],
                'parent_id' => null,
                'start_offset_days' => null,
                'due_offset_days' => null,
            ],
            'run_count' => 0,
            'created_by' => fn (array $attributes) => self::member(self::project($attributes['project_id'])),
        ];
    }

    /**
     * With the schedule (read as REST input, so a wrong one fails the test), counting from now: `schedule_from` now and
     * `next_run_at` the first term after now on the calendar of the organisation.
     *
     * @param  array<string, mixed>  $schedule
     */
    public function scheduled(array $schedule): static
    {
        return $this->state(function () use ($schedule) {
            $parsed = Schedule::parse($schedule);
            $now = now()->toImmutable();

            return [
                'schedule' => $parsed->toArray(),
                'schedule_from' => $now,
                'next_run_at' => TemplateSchedule::nextRunAt($parsed, $now, 0, $now, new DateTimeZone(Organization::current()->timezone)),
            ];
        });
    }

    private static function project(mixed $projectId): Project
    {
        return Project::query()->whereKey($projectId)->firstOrFail();
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
