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
use App\Support\RunQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Sets the agent configuration of a bot as a whole (spec 10.4, org admins, A485): on or off, the runner pool (active
 * runners; empty is every runner of the organization), the CLI and its models (the default and per kind of run, each
 * from the fixed list of the CLI, spec 7.7) and the efforts (default and per kind, from the levels of the CLI, none for
 * the default of the CLI; keys left out keep the saved ones, WEBU-66). Switching it on needs a bot that can be an agent (spec 7.2): active, with a
 * responsible person, not the default bot. No instruction, no places, no time limits per bot. Only a real change is
 * written and recorded; the keys of the answer sent back are passed over.
 */
final class SaveAgentConfig
{
    use AsAction;

    public const FIELDS = ['enabled', 'runner_ids', 'cli', 'model', 'models', 'effort', 'efforts'];

    /**
     * @param  array<array-key, mixed>  $input  `enabled`, `runner_ids`, `cli`, `model`, `models`, `effort`, `efforts`
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
        $efforts = $cli?->efforts() ?? [];
        $levels = __('field.effort.invalid', ['allowed' => $efforts === [] ? '–' : implode(', ', $efforts)]);

        $valid = Validator::make($input, [
            'enabled' => ['required', 'boolean'],
            'runner_ids' => ['present', 'array', 'list'],
            'runner_ids.*' => ['string', 'ulid', 'distinct', Rule::exists('runners', 'id')->whereNull('revoked_at')],
            'cli' => ['required', Rule::in(AgentCli::VALUES)],
            'model' => ['required', 'string', Rule::in($models)],
            'models' => ['present', 'array:'.implode(',', RunType::VALUES)],
            'models.*' => ['string', Rule::in($models)],
            'effort' => ['sometimes', 'nullable', 'string', Rule::in($efforts)],
            'efforts' => ['sometimes', 'nullable', 'array:'.implode(',', RunType::VALUES)],
            'efforts.*' => ['string', Rule::in($efforts)],
        ], [
            'enabled' => __('field.boolean'),
            'runner_ids' => __('field.runner_ids.invalid'),
            'runner_ids.*' => __('field.runner_ids.unknown'),
            'cli' => __('field.cli.invalid', ['allowed' => implode(', ', AgentCli::VALUES)]),
            'model' => __('field.model.invalid', ['allowed' => $known]),
            'models' => __('field.models.invalid', ['allowed' => implode(', ', RunType::VALUES)]),
            'models.*' => __('field.model.invalid', ['allowed' => $known]),
            'effort' => $levels,
            'efforts' => __('field.models.invalid', ['allowed' => implode(', ', RunType::VALUES)]),
            'efforts.*' => $levels,
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

        $saved = DB::transaction(function () use ($actor, $bot, $next, $valid, $efforts): AgentConfig {
            $config = AgentConfig::query()->lockForUpdate()->where('bot_id', $bot->id)->first() ?? AgentConfig::unsaved($bot);
            // a key left out keeps the saved efforts, as far as the CLI still takes them
            $keep = fn (mixed $effort): bool => is_string($effort) && in_array($effort, $efforts, true);
            $next['effort'] = array_key_exists('effort', $valid) ? $valid['effort'] : ($keep($config->effort) ? $config->effort : null);
            $next['efforts'] = array_filter(array_key_exists('efforts', $valid) ? array_intersect_key($valid['efforts'] ?? [], array_flip(RunType::VALUES)) : ($config->efforts ?? []), $keep);
            ksort($next['efforts']);
            $changes = CatalogInput::changes(self::snapshot($config), $next);

            if ($changes === []) {
                return $config;
            }

            $config->fill($next)->save();
            EventRecorder::record(EventType::AgentConfigUpdated, $actor, $config, null, $changes, ['bot_id' => $bot->id]);

            return $config;
        }, 3);

        // the waiting runs of the bot say at once why they wait (switched off: `agent_off`, A490); after the commit, so
        // no claim ever waits for the configuration while holding a run (Runner → run → configuration)
        RunQueue::refreshReasons($bot->id);

        return $saved;
    }

    /** Why a bot cannot work as an agent (spec 7.2), or null. */
    public static function refusal(User $bot): ?string
    {
        $key = match (true) {
            $bot->is_default_bot => 'field.enabled.default_bot',
            $bot->owner_id === null => 'field.enabled.no_owner',
            $bot->isDisabled() => 'field.enabled.disabled',
            default => null,
        };

        return $key === null ? null : (string) __($key);
    }

    /**
     * @return array{enabled: bool, runner_ids: list<string>, cli: string, model: string, models: array<string, string>, effort: string|null, efforts: array<string, string>}
     */
    private static function snapshot(AgentConfig $config): array
    {
        $models = $config->models;
        ksort($models);
        $efforts = $config->efforts ?? [];
        ksort($efforts);

        return ['enabled' => $config->enabled, 'runner_ids' => $config->runner_ids, 'cli' => $config->cli->value, 'model' => $config->model, 'models' => $models, 'effort' => $config->effort, 'efforts' => $efforts];
    }
}
