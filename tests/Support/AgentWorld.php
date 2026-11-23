<?php

namespace Tests\Support;

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Domain\Agents\RunType;
use App\Models\AgentConfig;
use App\Models\AgentRun;
use App\Models\Project;
use App\Models\Runner;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\RunTokens;

/**
 * Agents, runners and runs for the tests of WEBU-20: an agent is a bot of a person with an agent configuration that is
 * switched on, a member of the projects named; a runner with a known token; a run with the token of its run.
 */
final class AgentWorld
{
    /**
     * A bot with an agent configuration switched on, member of the projects.
     *
     * @param  array<string, mixed>  $config  attributes of the configuration
     */
    public static function agent(array $projects = [], array $config = [], string $name = 'Kira'): User
    {
        $bot = User::factory()->bot(User::factory()->create())->create(['name' => $name]);
        AgentConfig::factory()->create(['bot_id' => $bot->id, ...$config]);

        foreach ($projects as $project) {
            app(RoleAssignments::class)->setProjectRole($bot, $project, ProjectRole::Member);
        }

        return $bot;
    }

    /**
     * A runner whose token is the one answered with it.
     *
     * @param  array<string, mixed>  $attributes
     * @return array{0: Runner, 1: string}
     */
    public static function runner(array $attributes = []): array
    {
        $token = Runner::newToken();

        return [Runner::factory()->withToken($token)->create($attributes), $token];
    }

    /**
     * A queued run of the agent at a new item of the project (or the item given).
     *
     * @param  array<string, mixed>  $attributes
     */
    public static function run(User $agent, Project|WorkItem $at, RunType $type = RunType::Task, array $attributes = []): AgentRun
    {
        $item = $at instanceof WorkItem ? $at : WorkItem::factory()->create(['project_id' => $at->id]);

        return AgentRun::factory()->type($type)->create(['bot_id' => $agent->id, 'work_item_id' => $item->id, 'project_id' => $item->project_id, ...$attributes]);
    }

    /** The plain text of a new token of the run. */
    public static function token(AgentRun $run): string
    {
        return RunTokens::issue($run);
    }

    /**
     * The headers of the runner protocol with the token of the runner.
     *
     * @return array<string, string>
     */
    public static function headers(string $token, int $protocol = 1, string $version = '0.3.2'): array
    {
        return ['Authorization' => "Bearer {$token}", 'X-Werkbuch-Protocol' => (string) $protocol, 'X-Werkbuch-Runner-Version' => $version];
    }
}
