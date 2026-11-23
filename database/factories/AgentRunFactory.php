<?php

namespace Database\Factories;

use App\Domain\Agents\AgentCli;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Models\AgentConfig;
use App\Models\AgentRun;
use App\Models\Runner;
use App\Models\WorkItem;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * A queued `task` of a new item for the bot the caller names, with Claude Code and Sonnet. No events, no token.
 *
 * @extends Factory<AgentRun>
 */
class AgentRunFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'bot_id' => fn () => AgentConfig::factory()->create()->bot_id,
            'type' => RunType::Task,
            'status' => RunStatus::Queued,
            'cli' => AgentCli::Claude,
            'model' => 'sonnet',
            'model_source' => 'default',
            'work_item_id' => WorkItem::factory(),
            'project_id' => fn (array $attributes) => WorkItem::query()->findOrFail($attributes['work_item_id'])->project_id,
            'context' => [],
            'attempt' => 1,
        ];
    }

    public function type(RunType $type): static
    {
        return $this->state(['type' => $type]);
    }

    /** Running on the runner since the moment given (now without one), its lease a minute from then. */
    public function running(Runner $runner, ?DateTimeInterface $since = null): static
    {
        return $this->state(fn () => [
            'status' => RunStatus::Running,
            'runner_id' => $runner->id,
            'started_at' => $since ?? now(),
            'lease_expires_at' => Carbon::instance($since ?? now())->addMinute(),
        ]);
    }
}
