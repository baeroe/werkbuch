<?php

namespace App\Actions\Automations;

use App\Access\Authorize;
use App\Domain\Automations\AutomationKey;
use App\Domain\Workflow\StateCategory;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Automation;
use App\Models\Project;
use App\Models\WorkflowState;
use App\Support\Actor;
use App\Support\CatalogLock;
use App\Support\Ids;
use App\Support\MemberInput;
use App\Support\ProjectAutomations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Switches an automation of a project on or off and sets its settings (`PUT /api/v1/projects/{project}/automations/{key}`,
 * the admins of the project, spec 4.13). `enabled` is required (a value of Laravel's `boolean`); `settings` is an
 * object of which only the keys of the automation count (`days` 1–3650 for the nightly ones, `state_id` for Auto-Close),
 * a key not sent keeps what is stored. `state_id` is a Canceled state of the workflow of the project, required to
 * switch Auto-Close on; a stored one that is no longer canceled keeps an automation that is off saveable (K11). An
 * archived project stays changeable for its admins. Runs under the organisation (shared: a SaveWorkflow that removes the
 * state waits or is waited for, K11), then the project row; writes the row by `(project_id, key)` and records
 * `automation.updated` with `{enabled, days, state_id}` as far as they change. Nothing changed writes nothing.
 */
final class SaveAutomation
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `enabled`, `settings`
     *
     * @throws Problem 404 for an unknown key or a project the account does not see, 403 for anyone but its admins
     * @throws ValidationException at `enabled`, `settings`, `settings.days`, `settings.state_id`
     */
    public function handle(Actor $actor, Project|string $project, string $key, array $input): Automation
    {
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;
        $key = AutomationKey::tryFrom($key) ?? throw Problem::notFound();
        Authorize::check($actor, 'manageAutomations', $project);

        $errors = [];
        $enabled = self::enabled($input, $errors);
        $sent = self::settings($input, $key, $errors);

        return DB::transaction(function () use ($actor, $project, $key, $enabled, $sent, $errors): Automation {
            CatalogLock::share();
            $locked = MemberInput::lock($project);

            $current = Automation::query()->where('project_id', $locked->id)->where('key', $key)->lockForUpdate()->first()
                ?? ProjectAutomations::unsaved($locked->id, $key);
            $before = self::normal($key, $current->settings);
            $after = [...$before, ...$sent];

            if ($key === AutomationKey::AutoClose && ! isset($errors['settings.state_id']) && ($enabled === true || array_key_exists('state_id', $sent))) {
                $state = $after['state_id'];
                $canceled = is_string($state) && WorkflowState::query()->whereKey($state)
                    ->where('workflow_id', $locked->workflow_id)->where('category', StateCategory::Canceled)->exists();

                // switching on needs a state, and a state sent has to be canceled (null only takes it away)
                if (! $canceled && ($enabled === true || $state !== null)) {
                    $errors['settings.state_id'] = [__('field.settings.state_id')];
                }
            }

            if ($errors !== [] || $enabled === null) {
                throw ValidationException::withMessages($errors);
            }

            $changes = [];

            if ($current->enabled !== $enabled) {
                $changes['enabled'] = ['old' => $current->enabled, 'new' => $enabled];
            }

            foreach ($after as $name => $value) {
                if ($before[$name] !== $value) {
                    $changes[$name] = ['old' => $before[$name], 'new' => $value];
                }
            }

            if ($changes === []) {
                return $current;
            }

            Automation::query()->upsert([[
                'project_id' => $locked->id,
                'key' => $key->value,
                'enabled' => $enabled,
                'settings' => json_encode((object) $after, JSON_THROW_ON_ERROR),
            ]], ['project_id', 'key'], ['enabled', 'settings']);

            $saved = Automation::query()->where('project_id', $locked->id)->where('key', $key)->sole();
            EventRecorder::record(EventType::AutomationUpdated, $actor, $saved, $locked, $changes);

            return $saved;
        });
    }

    /**
     * The settings of the key as stored, in the order and with the keys of its defaults.
     *
     * @param  array<string, mixed>  $stored
     * @return array<string, mixed>
     */
    private static function normal(AutomationKey $key, array $stored): array
    {
        $settings = [];

        foreach ($key->defaults() as $name => $default) {
            $settings[$name] = array_key_exists($name, $stored) ? $stored[$name] : $default;
        }

        return $settings;
    }

    /**
     * @param  array<array-key, mixed>  $input
     * @param  array<string, array<int, mixed>>  $errors
     */
    private static function enabled(array $input, array &$errors): ?bool
    {
        $value = $input['enabled'] ?? null;

        if ($value === null) {
            $errors['enabled'] = [__('field.required')];

            return null;
        }

        // the values of Laravel's `boolean` rule (not 'true'/'false')
        $enabled = in_array($value, [true, 1, '1'], true) ? true : (in_array($value, [false, 0, '0'], true) ? false : null);

        if ($enabled === null) {
            $errors['enabled'] = [__('field.boolean')];
        }

        return $enabled;
    }

    /**
     * The settings sent that belong to the key, checked for their form (the state against the workflow under the lock).
     *
     * @param  array<array-key, mixed>  $input
     * @param  array<string, array<int, mixed>>  $errors
     * @return array<string, mixed>
     */
    private static function settings(array $input, AutomationKey $key, array &$errors): array
    {
        $settings = $input['settings'] ?? [];

        if (! is_array($settings) || ($settings !== [] && array_is_list($settings))) {
            $errors['settings'] = [__('field.settings.object')];

            return [];
        }

        $sent = array_intersect_key($settings, $key->defaults());

        if (array_key_exists('days', $sent) && ! (is_int($sent['days']) && $sent['days'] >= AutomationKey::MIN_DAYS && $sent['days'] <= AutomationKey::MAX_DAYS)) {
            $errors['settings.days'] = [__('field.settings.days', ['min' => AutomationKey::MIN_DAYS, 'max' => AutomationKey::MAX_DAYS])];
        }

        if (array_key_exists('state_id', $sent) && $sent['state_id'] !== null) {
            $state = Ids::normalize($sent['state_id']);

            if (is_string($state) && Str::isUlid($state)) {
                $sent['state_id'] = $state;
            } else {
                $errors['settings.state_id'] = [__('field.settings.state_id')];
            }
        }

        return $sent;
    }
}
