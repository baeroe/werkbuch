<?php

namespace App\OpenApi;

use App\Actions\Agents\SaveAgentConfig;
use App\Actions\Runners\UpdateRunner;
use App\Domain\Agents\AgentCli;
use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
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

        return self::object('Only the keys that are sent change (`'.implode('`, `', UpdateRunner::FIELDS).'`). Org admins and the default bot may write; every error comes in one 422.', [
            'name' => ['type' => 'string', 'minLength' => 1, 'maxLength' => Runner::NAME_MAX, 'description' => 'Trimmed; no other active runner may have it (in any case).'],
            'slots' => self::object('The places as a whole: code runs in all and per repo (at most as many as in all), light runs (`review`, `comment`) in a pot of their own.', [
                'total' => $slot, 'per_repo' => $slot, 'light' => $slot,
            ], ['total', 'per_repo', 'light'], false),
        ]);
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
            'models' => ['type' => 'object', 'properties' => array_fill_keys(RunType::VALUES, self::models()), 'additionalProperties' => false, 'description' => 'A model per kind of run; a kind left out takes `model`.'],
            'bot_id' => ['type' => 'string', 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
            'updated_at' => ['type' => ['string', 'null'], 'readOnly' => true, 'description' => 'Part of the answer; sent back, ignored.'],
        ], SaveAgentConfig::FIELDS);
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
                'waiting_reason' => ['type' => ['string', 'null'], 'enum' => [...AgentRun::WAITING_REASONS, null], 'description' => '`no_cli`: no runner of the pool has the CLI; `runner_offline`: the runner of its strand is offline (30 minutes, then another takes over).'],
                'cli' => ['type' => 'string', 'enum' => AgentCli::VALUES],
                'model_source' => ['type' => 'string', 'enum' => AgentRun::MODEL_SOURCES],
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
            'AgentConfigResource' => [
                'cli' => ['type' => 'string', 'enum' => AgentCli::VALUES],
                'models' => ['type' => 'object', 'additionalProperties' => ['type' => 'string'], 'description' => 'A model per kind of run.'],
                'updated_at' => $nullTime,
            ],
        ];
    }
}
