<?php

namespace App\Mcp\Tools;

use App\Actions\AgentRuns\CancelRun;
use App\Actions\AgentRuns\RetryRun;
use App\Actions\Agents\SaveAgentConfig;
use App\Actions\Runners\RevokeRunner;
use App\Actions\Runners\UpdateRunner;
use App\Http\Resources\AgentConfigResource;
use App\Http\Resources\AgentRunResource;
use App\Http\Resources\RunnerResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\OpenApi\AgentSchemas;
use App\Support\Actor;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-agents` (WEBU-20, A482), the pair of `agents`: renames a runner or sets its places, revokes it, cancels a run
 * or starts it again, sets the agent configuration of a bot. Pairing a runner is not here: a one-time code comes only
 * from the session (A397). An agent never steers runs through the token of its own run (403 `agent_forbidden`).
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageAgentsTool extends WriteTool
{
    protected string $name = 'manage-agents';

    protected string $title = 'Manage agents';

    protected string $description = 'Changes runners (name, places, revoke; org admins), the agent configuration of a bot (org admins) and runs (cancel, start again; who may change the item).';

    protected function actions(): array
    {
        $runner = ['runner' => ToolSchema::reference('runner')];
        $run = ['run' => ToolSchema::reference('run')];

        return [
            new McpAction(
                name: 'update-runner',
                summary: 'Renames a runner or sets its places; only the keys sent change.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new RunnerResource(UpdateRunner::run($actor, AgentsTool::runner($args), $args->input())->load('busyRuns'))),
                parameters: $runner,
                input: AgentSchemas::runner(),
                required: ['runner', 'input'],
                twin: 'PATCH runners/{runner}',
            ),
            new McpAction(
                name: 'revoke-runner',
                summary: 'Revokes a runner; what runs on it ends as canceled. Answers {canceled}.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['canceled' => RevokeRunner::run($actor, AgentsTool::runner($args))]),
                parameters: $runner,
                required: ['runner'],
                twin: 'DELETE runners/{runner}',
            ),
            new McpAction(
                name: 'cancel-run',
                summary: 'Cancels a run; one on a runner ends once the runner stopped it.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new AgentRunResource(CancelRun::run($actor, AgentsTool::run($args))->load('runner'))),
                parameters: $run,
                required: ['run'],
                twin: 'POST runs/{run}/cancel',
            ),
            new McpAction(
                name: 'retry-run',
                summary: 'Starts a run that ended without success again; answers the new run.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new AgentRunResource(RetryRun::run($actor, AgentsTool::run($args)))),
                parameters: $run,
                required: ['run'],
                twin: 'POST runs/{run}/retry',
            ),
            new McpAction(
                name: 'save-config',
                summary: 'Sets the agent configuration of a bot as a whole.',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new AgentConfigResource(SaveAgentConfig::run($actor, AgentsTool::bot($args), $args->input()))),
                parameters: ['bot' => ToolSchema::reference('user')],
                input: AgentSchemas::agentConfig(),
                required: ['bot', 'input'],
                twin: 'PUT bots/{user}/agent',
                path: ['user' => 'bot'],
            ),
        ];
    }
}
