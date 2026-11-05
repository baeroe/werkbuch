<?php

namespace App\Actions\Automations;

use App\Domain\Automations\AutomationKey;
use App\Domain\Workflow\StateCategory;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Automation;
use App\Models\Project;
use App\Models\Workflow;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Auto-Close of a project follows its workflow (spec 4.13, K11): when the state it moves items into is no Canceled state
 * of the workflow any more (the project got another workflow, the workflow lost the state or made it something other
 * than canceled), it takes the state the mapping names (old state → new state) when that one is canceled, else the
 * first Canceled state of the workflow (in its order), else it switches off without a state. One `automation.updated`
 * with the reason (`workflow_changed`, `state_removed`) in `meta.reason`; an automation that is off follows too and
 * stays off. A system action without rights or locks of its own: AssignWorkflow and SaveWorkflow call it in their
 * transaction under the catalog lock (and the project row); it runs as a savepoint of theirs (K6).
 */
final class FollowWorkflow
{
    use AsAction;

    /**
     * @param  array<string, string>  $stateMap  old state → new state
     * @param  Workflow  $workflow  the workflow of the project after the change
     */
    public function handle(Actor $actor, Project $locked, array $stateMap, Workflow $workflow, string $reason): void
    {
        $actor = $actor->withReason($reason);

        DB::transaction(function () use ($actor, $locked, $stateMap, $workflow): void {
            $automation = Automation::query()->where('project_id', $locked->id)->where('key', AutomationKey::AutoClose)->lockForUpdate()->first();
            $old = $automation?->settings['state_id'] ?? null;

            if ($automation === null || ! is_string($old)) {
                return;
            }

            $canceled = array_values($workflow->states()->where('category', StateCategory::Canceled)
                ->orderBy('position')->orderBy('id')->pluck('id')->all());

            if (in_array($old, $canceled, true)) {
                return;
            }

            $mapped = $stateMap[$old] ?? null;
            $state = in_array($mapped, $canceled, true) ? $mapped : ($canceled[0] ?? null);
            $enabled = $state !== null && $automation->enabled;

            $changes = $enabled === $automation->enabled ? [] : ['enabled' => ['old' => $automation->enabled, 'new' => $enabled]];
            $changes['state_id'] = ['old' => $old, 'new' => $state];

            $automation->update(['enabled' => $enabled, 'settings' => [...$automation->settings, 'state_id' => $state]]);
            EventRecorder::record(EventType::AutomationUpdated, $actor, $automation, $locked, $changes);
        });
    }

    /**
     * The projects of the workflow (not those being deleted) whose Auto-Close names a state that is no Canceled state of
     * it now: those SaveWorkflow lets follow, by ULID. A fixed number of queries.
     *
     * @return list<Project>
     */
    public static function strayed(Workflow $workflow): array
    {
        $canceled = $workflow->states()->where('category', StateCategory::Canceled)->pluck('id')->all();

        return array_values(Automation::query()->where('key', AutomationKey::AutoClose)
            ->whereIn('project_id', Project::query()->where('workflow_id', $workflow->id)->whereNull('deleting_at')->select('id'))
            ->with('project')->orderBy('project_id')->get()
            ->filter(fn (Automation $automation) => is_string($state = $automation->settings['state_id'] ?? null) && ! in_array($state, $canceled, true))
            ->map(fn (Automation $automation) => $automation->project)
            ->all());
    }
}
