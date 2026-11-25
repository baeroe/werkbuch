<?php

namespace App\Mcp\Tools;

use App\Actions\AgentRuns\CancelRun;
use App\Actions\AgentRuns\RetryRun;
use App\Actions\Agents\ResumeThread;
use App\Actions\Agents\SaveAgentConfig;
use App\Actions\Agents\SaveAgentRule;
use App\Actions\Agents\SaveProjectAgents;
use App\Actions\GitHub\ConfirmMergeGuard;
use App\Actions\GitHub\LinkRepository;
use App\Actions\GitHub\SyncGitHub;
use App\Actions\Runners\RevokeRunner;
use App\Actions\Runners\UpdateRunner;
use App\Http\Resources\AgentConfigResource;
use App\Http\Resources\AgentProjectSettingsResource;
use App\Http\Resources\AgentRuleResource;
use App\Http\Resources\AgentRunResource;
use App\Http\Resources\GitHubResource;
use App\Http\Resources\RunnerResource;
use App\Mcp\Support\McpAction;
use App\Mcp\Support\McpArguments;
use App\Mcp\Support\McpResult;
use App\Mcp\Support\ToolSchema;
use App\Mcp\Support\WriteTool;
use App\OpenApi\AgentSchemas;
use App\OpenApi\GitHubSchemas;
use App\Support\Actor;
use App\Support\References;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;
use Laravel\Mcp\Server\Tools\Annotations\IsOpenWorld;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

/**
 * `manage-agents` (WEBU-20, A482), the pair of `agents`: renames a runner or sets its places, revokes it, cancels a run
 * or starts it again, resumes the strand of an item after GitHub was disconnected (WEBU-28), sets the agent configuration of a bot, syncs the GitHub app, gives a project its repo and confirms
 * an unauthorized merge (WEBU-24). Pairing a runner and connecting or disconnecting GitHub are not here: only from the
 * session (A397). An agent never steers runs through the token of its own run (403 `agent_forbidden`).
 */
#[IsDestructive]
#[IsReadOnly(false)]
#[IsOpenWorld(false)]
final class ManageAgentsTool extends WriteTool
{
    protected string $name = 'manage-agents';

    protected string $title = 'Manage agents';

    protected string $description = 'Changes runners (name, places, revoke; org admins), the agent configuration of a bot (org admins), runs (cancel, start again; who may change the item), the GitHub apps (sync), the repo and the agent settings of a project, the working rules of the agents.';

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
                name: 'resume-thread',
                summary: 'Resumes a strand paused by a GitHub disconnect. Answers {run, braked}.',
                run: fn (Actor $actor, McpArguments $args): McpResult => AgentsTool::resumed(ResumeThread::run($actor, References::item($args->reference('item')))),
                parameters: ['item' => ToolSchema::reference('item')],
                required: ['item'],
                twin: 'POST work-items/{item}/agent/resume',
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
            new McpAction(
                name: 'sync-github',
                summary: 'Reads the installations of the GitHub apps and their repos from GitHub again (org admins).',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::body(['data' => (new GitHubResource(SyncGitHub::run($actor)))->resolve(request())]),
                twin: 'POST github/sync',
            ),
            new McpAction(
                name: 'set-repository',
                summary: 'Gives a project its repo (one the app reaches, at most one project per repo) and base branch, or none; admins of the project.',
                run: fn (Actor $actor, McpArguments $args): McpResult => AgentsTool::repository(LinkRepository::run($actor, References::project($args->reference('project')), $args->input())),
                parameters: ['project' => ToolSchema::reference('project')],
                input: GitHubSchemas::repositoryBody(),
                required: ['project', 'input'],
                twin: 'PUT projects/{project}/repository',
            ),
            new McpAction(
                name: 'confirm-merge-guard',
                summary: 'Confirms an unauthorized merge: the guard goes and the paused strands of the project are open again; admins of the project.',
                run: fn (Actor $actor, McpArguments $args): McpResult => AgentsTool::repository(ConfirmMergeGuard::run($actor, References::project($args->reference('project')))),
                parameters: ['project' => ToolSchema::reference('project')],
                required: ['project'],
                twin: 'POST projects/{project}/repository/confirm-guard',
            ),
            new McpAction(
                name: 'save-rule',
                summary: 'Sets the working rules of a kind of run; `null` restores the standard (org admins).',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new AgentRuleResource(SaveAgentRule::run($actor, $args->reference('kind'), $args->input()))),
                parameters: ['kind' => ToolSchema::reference('kind')],
                input: AgentSchemas::ruleBody(),
                required: ['kind', 'input'],
                twin: 'PUT agent-rules/{kind}',
            ),
            new McpAction(
                name: 'save-project-agents',
                summary: 'Sets the agent settings of a project as a whole (admins of the project).',
                run: fn (Actor $actor, McpArguments $args): McpResult => McpResult::resource(new AgentProjectSettingsResource(SaveProjectAgents::run($actor, References::project($args->reference('project')), $args->input()))),
                parameters: ['project' => ToolSchema::reference('project')],
                input: AgentSchemas::projectAgents(),
                required: ['project', 'input'],
                twin: 'PUT projects/{project}/agents',
            ),
        ];
    }
}
