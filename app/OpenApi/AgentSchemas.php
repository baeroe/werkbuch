<?php

namespace App\OpenApi;

use App\Actions\Agents\SaveAgentConfig;
use App\Actions\Agents\SaveAgentRule;
use App\Actions\Agents\SaveProjectAgents;
use App\Actions\Runners\UpdateRunner;
use App\Domain\Agents\AgentCli;
use App\Domain\Agents\AgentModel;
use App\Domain\Agents\Brakes;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Models\AgentProjectSettings;
use App\Models\AgentRun;
use App\Models\AgentRunEvent;
use App\Models\Runner;

/**
 * The hand-written bodies and answers of runners, the agent configuration of bots and the runs of agents (WEBU-20), and
 * the parts of their resources Scramble cannot read (`Components`). Plain JSON Schema (OpenAPI 3.1). The bodies are
 * open (`x-werkbuch-open`): the actions pass over keys they do not know (K2), the keys of an answer sent back too.
 */
final class AgentSchemas
{
    private const ULID = PathParameters::ULID;

    /**
     * @param  array<string, array<string, mixed>>  $properties
     * @param  list<string>  $required
     * @return array<string, mixed>
     */
    private static function object(string $description, array $properties, array $required = [], bool $open = true): array
    {
        return array_filter([
            'type' => 'object',
            'description' => $description,
            'x-werkbuch-open' => $open ?: null,
            'properties' => $properties,
            'required' => $required ?: null,
        ], fn (mixed $value) => $value !== null && $value !== '');
    }

    /** @return array<string, mixed> */
    private static function places(string $description): array
    {
        $slot = ['type' => 'integer', 'minimum' => 0, 'maximum' => Runner::MAX_SLOTS];

        return self::object($description, ['total' => $slot, 'per_repo' => $slot, 'light' => $slot], ['total', 'per_repo', 'light'], false);
    }

    /** @return array<string, mixed> */
    private static function models(): array
    {
        $all = array_values(array_unique(array_merge(...array_map(fn (AgentCli $cli) => $cli->models(), AgentCli::cases()))));

        return ['type' => 'string', 'enum' => $all, 'description' => 'A model of the list of the CLI: '.implode('; ', array_map(fn (AgentCli $cli) => "`{$cli->value}`: ".implode(', ', $cli->models()), AgentCli::cases())).'.'];
    }

    /**
     * `PATCH /runners/{runner}`.
     *
     * @return array<string, mixed>
     */
    public static function runner(): array
    {
        $slot = ['type' => 'integer', 'minimum' => 1, 'maximum' => Runner::MAX_SLOTS];

        return self::object('Only the keys sent change (`'.implode('`, `', UpdateRunner::FIELDS).'`); every error in one 422.', [
            'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => Runner::NAME_MAX, 'description' => 'Trimmed; no other active runner may have it (in any case).'],
            'slots' => self::object('The places as a whole: code runs in all and per repo (at most all), light runs (`review`, `comment`) apart.', [
                'total' => $slot, 'per_repo' => $slot, 'light' => $slot,
            ], ['total', 'per_repo', 'light'], false),
            'usage_limit' => ['type' => ['integer', 'null'], 'minimum' => 1, 'maximum' => 100, 'description' => 'From this percent of the Claude subscription (session or week) no new `claude` runs; `null` none.'],
        ]);
    }

    /**
     * The answer of resuming the strand of an item (`POST /work-items/{item}/agent/resume`, WEBU-28).
     *
     * @return array<string, mixed>
     */
    public static function resumed(): array
    {
        return self::object('The strand goes on.', ['data' => self::object('', [
            'run' => ['anyOf' => [['$ref' => '#/components/schemas/AgentRunResource'], ['type' => 'null']], 'description' => 'The correction it queued; `null` when the strand stopped at its brake.'],
            'braked' => ['type' => 'boolean', 'description' => 'The brakes keep counting: the strand reached its brake and paused again.'],
        ], ['run', 'braked'], false)], ['data'], false);
    }

    /**
     * The answer of revoking a runner.
     *
     * @return array<string, mixed>
     */
    public static function revoked(): array
    {
        return self::object('The runner is revoked.', ['canceled' => ['type' => 'integer', 'minimum' => 0, 'description' => 'How many of its runs ended as canceled.']], ['canceled'], false);
    }

    /**
     * `PUT /bots/{user}/agent`.
     *
     * @return array<string, mixed>
     */
    public static function agentConfig(): array
    {
        return self::object('The configuration as a whole; all five keys are required. Org admins and the default bot may write; every error comes in one 422.', [
            'enabled' => ['type' => 'boolean', 'description' => 'Whether the bot works as an agent; on needs an active bot with a responsible person, not the default bot.'],
            'runner_ids' => ['type' => 'array', 'items' => ['type' => 'string', 'pattern' => self::ULID], 'description' => 'The runner pool: active runners; empty is every runner of the organization.'],
            'cli' => ['type' => 'string', 'enum' => AgentCli::VALUES],
            'model' => [...self::models(), 'description' => 'The default model, one of the CLI.'],
            'models' => ['type' => ['object', 'array'], 'maxItems' => 0, 'properties' => array_fill_keys(RunType::VALUES, self::models()), 'additionalProperties' => false, 'description' => 'A model per kind of run; a kind left out takes `model`. An empty map may come as `[]`.'],
            'bot_id' => ['type' => 'string', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
            'updated_at' => ['type' => ['string', 'null'], 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
        ], SaveAgentConfig::FIELDS);
    }

    /**
     * One working rule (spec 7.3, 10.5) as it is answered.
     *
     * @return array<string, mixed>
     */
    private static function ruleOut(): array
    {
        return self::object('The working rules of the organization for a kind of run.', [
            'type' => ['type' => 'string', 'enum' => RunType::VALUES],
            'body' => ['type' => 'string', 'description' => 'Markdown; the standard of werkbuch in the language of the organization while nobody changed it.'],
            'standard' => ['type' => 'boolean', 'description' => 'Whether the text is the standard (a new standard of a release reaches it).'],
            'contract' => ['type' => 'string', 'description' => 'The contract of the kind, fixed in code and first in every prompt; read only.'],
            'standard_body' => ['type' => 'string', 'description' => 'The standard of werkbuch for the kind in the language of the organization; what `null` restores.'],
        ], ['type', 'body', 'standard', 'contract', 'standard_body'], false);
    }

    /**
     * `GET /agent-rules`.
     *
     * @return array<string, mixed>
     */
    public static function rules(): array
    {
        return self::object('The rules of every kind of run, in the order of the kinds.', ['data' => ['type' => 'array', 'items' => self::ruleOut()]], ['data'], false);
    }

    /**
     * `PUT /agent-rules/{kind}` (the answer).
     *
     * @return array<string, mixed>
     */
    public static function rule(): array
    {
        return self::object('The rules of the kind after the change.', ['data' => self::ruleOut()], ['data'], false);
    }

    /**
     * `PUT /agent-rules/{kind}` (the body).
     *
     * @return array<string, mixed>
     */
    public static function ruleBody(): array
    {
        return self::object('The rules of the kind; org admins write.', [
            'body' => ['type' => ['string', 'null'], 'maxLength' => SaveAgentRule::BODY_MAX, 'description' => 'Markdown; `null` or empty restores the standard.'],
            'type' => ['type' => 'string', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
            'standard' => ['type' => 'boolean', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
            'contract' => ['type' => 'string', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
            'standard_body' => ['type' => 'string', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
        ], SaveAgentRule::FIELDS);
    }

    /**
     * `PUT /projects/{project}/agents`.
     *
     * @return array<string, mixed>
     */
    public static function projectAgents(): array
    {
        $text = fn (int $max, string $what) => ['type' => ['string', 'null'], 'maxLength' => $max, 'description' => $what];
        $brake = fn (string $what) => ['type' => 'integer', 'minimum' => 1, 'maximum' => Brakes::MAX, 'description' => $what];
        $model = ['type' => 'string', 'enum' => AgentModel::values()];

        return self::object('The agent settings of the project as a whole (every key required); its admins write.', [
            'review_bot_id' => ['type' => ['string', 'null'], 'pattern' => self::ULID, 'description' => 'The review agent: a bot with a responsible person that may edit items of the project; `null`: the bot of the strand reviews, PRs of persons are not reviewed.'],
            'instructions' => $text(SaveProjectAgents::TEXT_MAX, 'Markdown for every run of the project (after the rules and the guidance of the type).'),
            'models' => ['type' => ['object', 'array'], 'maxItems' => 0, 'properties' => array_fill_keys(RunType::VALUES, $model), 'additionalProperties' => false, 'description' => 'A model per kind of run, `cli:model`; it counts only for agents with that CLI. An empty map may come as `[]`.'],
            'max_corrections' => $brake('Corrections per strand before it pauses.'),
            'max_conflicts' => $brake('Conflicts per strand before it pauses.'),
            'review_person_prs' => ['type' => 'boolean', 'description' => 'Whether PRs of persons get a review.'],
            'comment_on_pr' => ['type' => 'boolean', 'description' => 'Whether the app comments the linked items at a PR.'],
            'merge_method' => ['type' => 'string', 'enum' => AgentProjectSettings::MERGE_METHODS],
            'setup_command' => $text(SaveProjectAgents::COMMAND_MAX, 'Run by the runner after it made a worktree.'),
            'stop_command' => $text(SaveProjectAgents::COMMAND_MAX, 'Run in the worktree after every code run, e.g. `ddev stop`.'),
            'teardown_command' => $text(SaveProjectAgents::COMMAND_MAX, 'Run by the runner before it removes a worktree.'),
            'project_id' => ['type' => 'string', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
            'steps_complete' => ['type' => 'boolean', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
            'bots' => ['type' => 'array', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
            'updated_at' => ['type' => ['string', 'null'], 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
        ], SaveProjectAgents::FIELDS);
    }

    /**
     * What Scramble cannot read of the resources, resource → property → schema.
     *
     * @return array<string, array<string, array<string, mixed>>>
     */
    public static function patches(): array
    {
        $time = ['type' => 'string', 'format' => 'date-time'];
        $nullTime = ['type' => ['string', 'null'], 'format' => 'date-time'];
        $names = ['type' => 'array', 'items' => ['type' => 'string']];
        $window = ['anyOf' => [self::object('A window: used in percent and when it resets.', [
            'percent' => ['type' => 'number', 'minimum' => 0, 'maximum' => 100], 'resets_at' => $nullTime,
        ], ['percent', 'resets_at'], false), ['type' => 'null']]];

        return [
            'RunnerResource' => [
                'os' => ['type' => 'string', 'enum' => ['darwin', 'linux']],
                'arch' => ['type' => 'string', 'enum' => ['arm64', 'amd64']],
                'online' => ['type' => 'boolean', 'description' => 'A contact within the last minute.'],
                'last_seen_at' => $nullTime,
                'slots' => self::places('The places as set in werkbuch.'),
                'slots_used' => self::places('What runs now: code runs in all, of the busiest repo, light runs.'),
                'load' => ['anyOf' => [self::object('The last load the runner sent: percent, sizes in GB.', [
                    'cpu' => ['type' => 'number'], 'gpu' => ['type' => ['number', 'null'], 'description' => '`null` where the system gives no GPU load without root.'],
                    'ram_used' => ['type' => 'number'], 'ram_total' => ['type' => 'number'], 'disk_free' => ['type' => 'number'], 'disk_total' => ['type' => 'number'],
                    'measured_at' => $nullTime,
                ], ['cpu', 'gpu', 'ram_used', 'ram_total', 'disk_free', 'disk_total', 'measured_at'], false), ['type' => 'null']]],
                'clis' => ['type' => 'array', 'description' => 'The CLIs the runner found; a run goes only to a runner with its CLI installed and signed in.', 'items' => self::object('A CLI of the machine.', [
                    'cli' => ['type' => 'string', 'enum' => AgentCli::VALUES], 'installed' => ['type' => 'boolean'], 'version' => ['type' => ['string', 'null']],
                    'logged_in' => ['type' => 'boolean'], 'path' => ['type' => ['string', 'null']],
                ], ['cli', 'installed', 'version', 'logged_in', 'path'], false)],
                'equipment' => ['anyOf' => [self::object('What the harness of the machine offers an agent, as the runner reports it.', [
                    'mcp_servers' => $names, 'skills' => $names, 'plugins' => $names,
                    'werkbuch_access' => [...$names, 'description' => 'MCP servers of the machine that reach werkbuch with a token of their own: a way past the run token.'],
                ], ['mcp_servers', 'skills', 'plugins', 'werkbuch_access'], false), ['type' => 'null']]],
                'usage' => ['anyOf' => [self::object('The used share of the Claude subscription, as the runner last read it from the sign-in of Claude Code.', [
                    'session' => $window, 'week' => $window,
                ], ['session', 'week'], false), ['type' => 'null']], 'description' => '`null` before a runner that reads it reported.'],
                'usage_limit' => ['type' => ['integer', 'null'], 'description' => 'The percent from which it takes no new runs of `claude`; `null` for none.'],
                'over_usage_limit' => ['type' => 'boolean', 'description' => 'The limit holds back new runs of `claude` now.'],
                'created_at' => $nullTime, 'updated_at' => $nullTime,
            ],
            'RunnerPairingResource' => [
                'code' => ['type' => 'string', 'description' => 'Shown once, in the answer of making it.'],
                'command' => ['type' => 'string', 'description' => 'The command that installs a runner with the code; shown once.'],
                'expires_at' => $time,
                'redeemed_at' => $nullTime,
            ],
            'AgentRunResource' => [
                'type' => ['type' => 'string', 'enum' => RunType::VALUES],
                'status' => ['type' => 'string', 'enum' => RunStatus::VALUES],
                'waiting_reason' => ['type' => ['string', 'null'], 'enum' => [...AgentRun::WAITING_REASONS, null], 'description' => '`agent_off`: the agent is switched off; `no_cli`: no runner of the pool has the CLI; `runner_offline`: the runner of its strand is offline (30 minutes, then another takes over); `usage_limit`: the runner it waits for reached its usage limit of the Claude subscription.'],
                'cli' => ['type' => 'string', 'enum' => AgentCli::VALUES],
                'model_source' => ['type' => 'string', 'enum' => AgentRun::MODEL_SOURCES],
                'runner_last_seen_at' => [...$nullTime, 'description' => 'The last contact of the runner: how long a run waits for a runner that is offline.'],
                'lease_expires_at' => $nullTime, 'started_at' => $nullTime, 'deadline_at' => $nullTime, 'finished_at' => $nullTime,
                'result' => ['anyOf' => [self::object('What came of it, as the runner reported it.', [
                    'verdict' => ['type' => 'string', 'enum' => ['approve', 'changes']],
                    'text' => ['type' => 'string', 'description' => 'Findings (`review`) or the answer (`comment`) as Markdown.'],
                    'commit' => ['type' => 'string'],
                    'summary' => ['type' => 'string'],
                ], [], false), ['type' => 'null']]],
                'usage' => ['anyOf' => [self::object('Tokens, when the CLI reports them.', ['input' => ['type' => 'integer'], 'output' => ['type' => 'integer']], ['input', 'output'], false), ['type' => 'null']]],
                'created_at' => $nullTime, 'updated_at' => $nullTime,
            ],
            'AgentRunEventResource' => [
                'kind' => ['type' => 'string', 'enum' => AgentRunEvent::KINDS],
                'at' => $time,
            ],
            'AgentProjectSettingsResource' => [
                'models' => ['type' => 'object', 'additionalProperties' => ['type' => 'string', 'enum' => AgentModel::values()], 'description' => 'A model per kind of run, `cli:model`.'],
                'merge_method' => ['type' => 'string', 'enum' => AgentProjectSettings::MERGE_METHODS],
                'steps_complete' => ['type' => 'boolean', 'description' => 'Whether the workflow of the project names every step of the agents; without them no run starts.'],
                'bots' => ['type' => 'array', 'description' => 'The active bots of the project and the active org admin bots (not the default bot) and the saved review agent, by name, with their agent (A621).', 'items' => self::object('A bot of the project.', [
                    'bot_id' => ['type' => 'string'],
                    'enabled' => ['type' => 'boolean', 'description' => 'Whether it works as an agent.'],
                    'member' => ['type' => 'boolean', 'description' => 'Whether it is a member of the project: only a member takes items; an org admin bot may review without.'],
                    'reviews' => ['type' => 'boolean', 'description' => 'Whether it may be the review agent here: a responsible person, active, may edit items.'],
                    'cli' => ['type' => 'string', 'enum' => AgentCli::VALUES],
                    'model' => ['type' => 'string', 'description' => 'Its default model.'],
                    'models' => ['type' => 'object', 'additionalProperties' => ['type' => 'string'], 'description' => 'Its model per kind of run.'],
                ], ['bot_id', 'enabled', 'member', 'reviews', 'cli', 'model', 'models'], false)],
                'updated_at' => $nullTime,
            ],
            'AgentConfigResource' => [
                'cli' => ['type' => 'string', 'enum' => AgentCli::VALUES],
                'models' => ['type' => 'object', 'additionalProperties' => ['type' => 'string'], 'description' => 'A model per kind of run.'],
                'updated_at' => $nullTime,
            ],
        ];
    }
}
