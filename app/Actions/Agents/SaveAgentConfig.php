<?php

namespace App\Actions\Agents;

use App\Access\Authorize;
use App\Domain\Agents\AgentCli;
use App\Domain\Agents\RunType;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentConfig;
use App\Models\Organization;
use App\Models\Runner;
use App\Models\User;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Sets the agent configuration of a bot as a whole (spec 10.4, org admins, A485): on or off, the runner pool (active
 * runners; empty is every runner of the organization), the CLI and its models (the default and per kind of run, each
 * from the fixed list of the CLI, spec 7.7). Switching it on needs a bot that can be an agent (spec 7.2): active, with a
 * responsible person, not the default bot. No instruction, no places, no time limits per bot. Only a real change is
 * written and recorded; the keys of the answer sent back are passed over.
 */
final class SaveAgentConfig
{
    use AsAction;

    public const FIELDS = ['enabled', 'runner_ids', 'cli', 'model', 'models'];

    /**
     * @param  array<array-key, mixed>  $input  `enabled`, `runner_ids`, `cli`, `model`, `models`
     *
     * @throws Problem 403, 404 for an account that is no bot
     * @throws ValidationException
     */
    public function handle(Actor $actor, User $bot, array $input): AgentConfig
    {
        Authorize::check($actor, 'manageAgents', Organization::class);

        if (! $bot->isBot()) {
            throw Problem::notFound();
        }

        $input = Ids::normalize($input);
        $cli = is_string($input['cli'] ?? null) ? AgentCli::tryFrom($input['cli']) : null;
        $models = $cli?->models() ?? [];
        $known = $cli === null ? '' : implode(', ', $models);

        $valid = Validator::make($input, [
            'enabled' => ['required', 'boolean'],
            'runner_ids' => ['present', 'array', 'list'],
            'runner_ids.*' => ['string', 'ulid', 'distinct', Rule::exists('runners', 'id')->whereNull('revoked_at')],
            'cli' => ['required', Rule::in(AgentCli::VALUES)],
            'model' => ['required', 'string', Rule::in($models)],
            'models' => ['present', 'array:'.implode(',', RunType::VALUES)],
            'models.*' => ['string', Rule::in($models)],
        ], [
            'enabled' => __('field.boolean'),
            'runner_ids' => __('field.runner_ids.invalid'),
            'runner_ids.*' => __('field.runner_ids.unknown'),
            'cli' => __('field.cli.invalid', ['allowed' => implode(', ', AgentCli::VALUES)]),
            'model' => __('field.model.invalid', ['allowed' => $known]),
            'models' => __('field.models.invalid', ['allowed' => implode(', ', RunType::VALUES)]),
            'models.*' => __('field.model.invalid', ['allowed' => $known]),
        ])->validate();

        $enabled = filter_var($valid['enabled'], FILTER_VALIDATE_BOOLEAN);
        if ($enabled && ($refusal = self::refusal($bot)) !== null) {
            throw ValidationException::withMessages(['enabled' => $refusal]);
        }

        $next = [
            'enabled' => $enabled,
            'runner_ids' => array_values($valid['runner_ids']),
            'cli' => $valid['cli'],
            'model' => $valid['model'],
            'models' => array_intersect_key($valid['models'], array_flip(RunType::VALUES)),
        ];
        ksort($next['models']);

        return DB::transaction(function () use ($actor, $bot, $next): AgentConfig {
            $config = AgentConfig::query()->lockForUpdate()->where('bot_id', $bot->id)->first() ?? AgentConfig::unsaved($bot);
            $changes = CatalogInput::changes(self::snapshot($config), $next);

            if ($changes === []) {
                return $config;
            }

            $config->fill($next)->save();
            EventRecorder::record(EventType::AgentConfigUpdated, $actor, $config, null, $changes, ['bot_id' => $bot->id]);

            return $config;
        }, 3);
    }

    /** Why a bot cannot work as an agent (spec 7.2), or null. */
    public static function refusal(User $bot): ?string
    {
        return match (true) {
            $bot->is_default_bot => __('field.enabled.default_bot'),
            $bot->owner_id === null => __('field.enabled.no_owner'),
            $bot->isDisabled() => __('field.enabled.disabled'),
            default => null,
        };
    }

    /**
     * @return array{enabled: bool, runner_ids: list<string>, cli: string, model: string, models: array<string, string>}
     */
    private static function snapshot(AgentConfig $config): array
    {
        $models = $config->models;
        ksort($models);

        return ['enabled' => $config->enabled, 'runner_ids' => $config->runner_ids, 'cli' => $config->cli->value, 'model' => $config->model, 'models' => $models];
    }
}
