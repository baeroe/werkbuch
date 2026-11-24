<?php

namespace App\Actions\Agents;

use App\Access\Authorize;
use App\Domain\Agents\AgentModel;
use App\Domain\Agents\Brakes;
use App\Domain\Agents\RunType;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentProjectSettings;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\CatalogLock;
use App\Support\Ids;
use App\Support\ProjectAgentBots;
use App\Support\ProjectLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Sets the agent settings of a project as a whole (spec 10.3, A75: every key required, `null` where a key may be
 * empty): the review agent (an active bot with a responsible person, not the default bot, that may edit items of the
 * project), the text for agents, the model per kind of run (`cli:model`), the brakes (1–10), the review of PRs of
 * persons, the comment at PRs, the merge method and the commands of a worktree. `project.manage`; under the lock of the
 * project; `project.agent_settings_updated` with what changed.
 */
final class SaveProjectAgents
{
    use AsAction;

    public const FIELDS = ['review_bot_id', 'instructions', 'models', 'max_corrections', 'max_conflicts', 'review_person_prs', 'comment_on_pr', 'merge_method', 'setup_command', 'teardown_command'];

    public const TEXT_MAX = 20_000;

    public const COMMAND_MAX = 2000;

    /**
     * @param  array<array-key, mixed>  $input
     *
     * @throws Problem 403, 404
     * @throws ValidationException
     */
    public function handle(Actor $actor, Project|string $project, array $input): AgentProjectSettings
    {
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;
        Authorize::check($actor, 'manageAgentSettings', $project);

        $input = Ids::normalize($input);
        $valid = Validator::make($input, [
            'review_bot_id' => ['present', 'nullable', 'string', 'ulid'],
            'instructions' => ['present', 'nullable', 'string', 'max:'.self::TEXT_MAX],
            'models' => ['present', 'array:'.implode(',', RunType::VALUES)],
            'models.*' => ['string', Rule::in(AgentModel::values())],
            'max_corrections' => ['required', 'integer', 'between:1,'.Brakes::MAX],
            'max_conflicts' => ['required', 'integer', 'between:1,'.Brakes::MAX],
            'review_person_prs' => ['required', 'boolean'],
            'comment_on_pr' => ['required', 'boolean'],
            'merge_method' => ['required', Rule::in(AgentProjectSettings::MERGE_METHODS)],
            'setup_command' => ['present', 'nullable', 'string', 'max:'.self::COMMAND_MAX],
            'teardown_command' => ['present', 'nullable', 'string', 'max:'.self::COMMAND_MAX],
        ], [
            '*.present' => __('field.required'),
            '*.required' => __('field.required'),
            'review_bot_id' => __('field.review_bot_id.invalid'),
            'instructions' => __('field.instructions.max', ['max' => self::TEXT_MAX]),
            'models.array' => __('field.models.invalid', ['allowed' => implode(', ', RunType::VALUES)]),
            'models.*.*' => __('field.models.agent_model', ['allowed' => implode(', ', AgentModel::values())]),
            'max_corrections' => __('field.brake.invalid', ['max' => Brakes::MAX]),
            'max_conflicts' => __('field.brake.invalid', ['max' => Brakes::MAX]),
            'review_person_prs' => __('field.boolean'),
            'comment_on_pr' => __('field.boolean'),
            'merge_method' => __('field.merge_method.invalid', ['allowed' => implode(', ', AgentProjectSettings::MERGE_METHODS)]),
            'setup_command' => __('field.command.max', ['max' => self::COMMAND_MAX]),
            'teardown_command' => __('field.command.max', ['max' => self::COMMAND_MAX]),
        ])->validate();

        $text = fn (mixed $value) => is_string($value) && trim($value) !== '' ? $value : null;
        $models = array_intersect_key($valid['models'], array_flip(RunType::VALUES));
        ksort($models);
        $next = [
            'review_bot_id' => $valid['review_bot_id'],
            'instructions' => $text($valid['instructions']),
            'models' => $models,
            'max_corrections' => (int) $valid['max_corrections'],
            'max_conflicts' => (int) $valid['max_conflicts'],
            'review_person_prs' => filter_var($valid['review_person_prs'], FILTER_VALIDATE_BOOLEAN),
            'comment_on_pr' => filter_var($valid['comment_on_pr'], FILTER_VALIDATE_BOOLEAN),
            'merge_method' => $valid['merge_method'],
            'setup_command' => $text($valid['setup_command']),
            'teardown_command' => $text($valid['teardown_command']),
        ];

        return DB::transaction(function () use ($actor, $project, $next): AgentProjectSettings {
            CatalogLock::share();
            $locked = ProjectLock::lock($project);
            $settings = AgentProjectSettings::query()->lockForUpdate()->where('project_id', $locked->id)->first() ?? AgentProjectSettings::of($locked->id);

            // a new review agent only: the saved one is read when it changes, never on every save
            if ($next['review_bot_id'] !== null && $next['review_bot_id'] !== $settings->review_bot_id) {
                $reviewer = User::query()->whereKey($next['review_bot_id'])->first();
                if ($reviewer === null || ! ProjectAgentBots::reviews($reviewer, $locked)) {
                    throw ValidationException::withMessages(['review_bot_id' => __('field.review_bot_id.invalid')]);
                }
            }

            $changes = CatalogInput::changes($settings->only(self::FIELDS), $next);
            if ($changes !== []) {
                $settings->fill($next)->save();
                EventRecorder::record(EventType::ProjectAgentSettingsUpdated, $actor, $locked, $locked, $changes);
            }

            return $settings->setRelation('project', $locked);
        }, 3);
    }
}
