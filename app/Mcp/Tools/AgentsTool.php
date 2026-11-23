<?php

namespace App\Mcp\Tools;

use App\Actions\AgentRuns\GetRun;
use App\Actions\AgentRuns\ListRunEvents;
use App\Actions\AgentRuns\ListRuns;
use App\Actions\Agents\GetAgentConfig;
use App\Actions\Runners\GetRunner;
use App\Actions\Runners\ListRunners;
use App\Http\Resources\AgentConfigResource;
use App\Http\Resources\AgentRunEventResource;
use App\Http\Resources\AgentRunResource;
use App\Http\Resources\RunnerResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ReadTool;
use App\Mcp\Support\ToolSchema;
use App\Models\AgentRun;
use App\Models\Runner;
use App\Models\User;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `agents` (WEBU-20, A482): one tool for runners, the agent configuration of bots and the runs of agents, as
 * `organization` is one for the catalogs. Runners and configurations are the org admins'; runs read who sees their
 * project. Never a token.
 */
#[IsReadOnly]
#[IsOpenWorld(false)]
final class AgentsTool extends ReadTool
{
    protected string $name = 'agents';

    protected string $title = 'Agents';

    protected string $description = 'Reads runners (org admins), the agent configuration of a bot (org admins) and the runs of agents with their logs (who sees the project).';

    protected function actions(): array
    {
        $runners = ToolSchema::list(ListRunners::spec());
        $runs = ToolSchema::list(ListRuns::spec());
        $events = ToolSchema::list(ListRunEvents::spec());
        $runner = ['runner' => ToolSchema::reference('runner')];
        $run = ['run' => ToolSchema::reference('run')];

        return [
            new McpAction(
                name: 'list-runners',
                summary: 'A page of the runners.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListRunners::run($actor, $args->query(array_keys($runners))), RunnerResource::class),
                parameters: $runners,
                twin: 'GET runners',
            ),
            new McpAction(
                name: 'get-runner',
                summary: 'One runner with its places, load, CLIs and equipment.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new RunnerResource(GetRunner::run($actor, self::runner($args))->load('busyRuns'))),
                parameters: $runner,
                required: ['runner'],
                twin: 'GET runners/{runner}',
            ),
            new McpAction(
                name: 'list-runs',
                summary: 'A page of the runs, newest first; `filter.work_item_id` or `filter.runner_id` narrows them.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListRuns::run($actor, $args->query(array_keys($runs))), AgentRunResource::class),
                parameters: $runs,
                twin: 'GET runs',
            ),
            new McpAction(
                name: 'get-run',
                summary: 'One run.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new AgentRunResource(GetRun::run($actor, self::run($args)))),
                parameters: $run,
                required: ['run'],
                twin: 'GET runs/{run}',
            ),
            new McpAction(
                name: 'run-events',
                summary: 'The log of a run in the order it came.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::list(ListRunEvents::run($actor, self::run($args), $args->query(array_keys($events))), AgentRunEventResource::class),
                parameters: [...$run, ...$events],
                required: ['run'],
                twin: 'GET runs/{run}/events',
            ),
            new McpAction(
                name: 'get-config',
                summary: 'The agent configuration of a bot.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new AgentConfigResource(GetAgentConfig::run($actor, self::bot($args)))),
                parameters: ['bot' => ToolSchema::reference('user')],
                required: ['bot'],
                twin: 'GET bots/{user}/agent',
                path: ['user' => 'bot'],
            ),
        ];
    }

    public static function runner(McpArguments $args): Runner
    {
        return References::ulid(Runner::class, $args->reference('runner'));
    }

    public static function run(McpArguments $args): AgentRun
    {
        return References::ulid(AgentRun::class, $args->reference('run'));
    }

    public static function bot(McpArguments $args): User
    {
        return References::ulid(User::class, $args->reference('bot'));
    }
}
