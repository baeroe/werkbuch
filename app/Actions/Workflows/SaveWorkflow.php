<?php

namespace App\Actions\Workflows;

use App\Access\Authorize;
use App\Actions\Automations\FollowWorkflow;
use App\Actions\WorkItems\RemapStates;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkflowTransition;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\CatalogLock;
use App\Support\WorkflowInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a workflow or replaces one as a whole (P4, P24): name, description, the default mark, free or a matrix, the
 * states in order and the transitions (org admins). New states come with ids of the client and get ULIDs; the start
 * state and the transitions are translated (P3). A workflow that cannot be saved (no start state, no Completed state,
 * a state the start does not reach) is refused with its findings and nothing is written. One workflow is the default
 * at all times: a new default takes the mark from the old one, the default keeps it until another one takes it.
 * A state that goes while items stand in it (in any project of the workflow) needs a state that takes them over in
 * `state_mapping` (removed state → key of a state of the input, a new one with its local id too), else 409
 * `state_in_use` naming the states and their items, and nothing is written; the items move before their states go
 * (RemapStates, `state_removed`); Auto-Close of a project whose state goes or stops being canceled follows (FollowWorkflow,
 * `state_removed`). Everything runs under the catalog lock, one change of the catalog at a time, each from
 * what the one before left, and every change of an item waits for it. Only what really changes is written and
 * recorded; the same input again writes nothing.
 */
final class SaveWorkflow
{
    use AsAction;

    /** The keys of the input the action reads (the OpenAPI document holds its body against them). */
    public const FIELDS = ['name', 'description', 'is_default', 'is_free', 'initial_state_id', 'states', 'transitions', 'state_mapping'];

    /**
     * @param  array<array-key, mixed>  $input  `name`, `description`, `is_default`, `is_free`, `initial_state_id`, `states`, `transitions`, `state_mapping`
     *
     * @throws ValidationException
     * @throws Problem 422 `invalid_workflow`, 409 `state_in_use`, 404 for a workflow deleted meanwhile
     */
    public function handle(Actor $actor, ?Workflow $workflow, array $input): Workflow
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::Workflows);

        $input = WorkflowInput::normalize($input);

        return DB::transaction(function () use ($actor, $workflow, $input): Workflow {
            CatalogLock::take();

            $current = $workflow === null
                ? null
                : Workflow::query()->with(['states', 'transitions'])->find($workflow->id) ?? throw Problem::notFound();

            $valid = WorkflowInput::validate($input, $current);
            $issues = WorkflowInput::graph($valid)->issues();

            if ($issues !== []) {
                WorkflowInput::refuse($issues, $valid);
            }

            if ($current !== null && $current->is_default && ! $valid['is_default']) {
                throw ValidationException::withMessages(['is_default' => __('field.is_default.required')]);
            }

            $keys = array_column($valid['states'], 'key');
            $removed = $current === null ? [] : array_values(array_diff($current->states->modelKeys(), array_column($valid['states'], 'existing')));

            // the keys are states that go (a state that stays is 422, P17, and says so), the targets keys of the input
            $staying = $current === null ? [] : array_values(array_diff($current->states->modelKeys(), $removed));
            $mappingErrors = WorkflowInput::mappingErrors('state_mapping', $valid['state_mapping'], $removed, $keys, $staying);

            if ($mappingErrors !== []) {
                throw Problem::invalid($mappingErrors);
            }

            // a state that goes while items of any project of the workflow (archived ones and projects in deletion too)
            // stand in it needs a new one
            $projectIds = [];

            if ($current !== null && $removed !== []) {
                /** @var list<string> $projectIds */
                $projectIds = Project::query()->where('workflow_id', $current->id)->pluck('id')->all();
                $unmapped = WorkflowInput::unmapped($valid['state_mapping'], $current->states->whereIn('id', $removed), ListStateUsage::counts($projectIds));

                if ($unmapped !== []) {
                    throw Problem::conflict('state_in_use', ['states' => $unmapped]);
                }
            }

            $before = $current === null ? null : self::snapshot($current);

            if ($valid['is_default']) {
                // one default at all times: the old one loses the mark before this one gets it
                $others = Workflow::query()->where('is_default', true)->when($current, fn ($query, Workflow $own) => $query->whereKeyNot($own->id))->get();

                foreach ($others as $other) {
                    $other->update(['is_default' => false]);
                    EventRecorder::record(EventType::WorkflowUpdated, $actor, $other, null, ['is_default' => ['old' => true, 'new' => false]]);
                }
            }

            $saved = $current ?? new Workflow;
            $saved->fill([
                'name' => $valid['name'],
                'description' => $valid['description'],
                'is_default' => $valid['is_default'],
                'is_free' => $valid['is_free'],
            ]);

            if (! $saved->exists) {
                $saved->save();
            }

            // the states: the own ones are changed in place, every other one is a new row; key → ULID
            $rows = $current === null ? [] : $current->states->keyBy('id')->all();
            $ids = [];

            foreach ($valid['states'] as $position => $state) {
                $row = $state['existing'] === null ? new WorkflowState(['workflow_id' => $saved->id]) : $rows[$state['existing']];
                $row->fill(['name' => $state['name'], 'icon' => $state['icon'], 'category' => $state['category'], 'position' => $position])->save();
                $ids[$state['key']] = $row->id;
            }

            // the transitions only between its own states: those that stay are kept, the others go, the missing ones
            // come, each in one statement
            $wanted = [];

            foreach ($valid['transitions'] as [$from, $to]) {
                $wanted[$ids[$from]."\n".$ids[$to]] = [$ids[$from], $ids[$to]];
            }

            $obsolete = [];

            foreach ($current === null ? [] : $current->transitions as $transition) {
                $pair = $transition->from_state_id."\n".$transition->to_state_id;

                if (isset($wanted[$pair])) {
                    unset($wanted[$pair]);
                } else {
                    $obsolete[] = $transition->id;
                }
            }

            if ($obsolete !== []) {
                WorkflowTransition::query()->whereKey($obsolete)->delete();
            }

            if ($removed !== []) {
                // the items move to the states that take them over (keys of the input → ULIDs) before their states go
                /** @var array<string, string> $sent */
                $sent = $valid['state_mapping'];
                RemapStates::run($actor, $projectIds, array_map(fn (string $key) => $ids[$key], $sent), RemapStates::STATE_REMOVED);
                WorkflowState::query()->whereKey($removed)->delete();
            }

            if ($wanted !== []) {
                $now = now();
                WorkflowTransition::query()->insert(array_map(fn (array $pair) => [
                    'id' => (new WorkflowTransition)->newUniqueId(),
                    'workflow_id' => $saved->id,
                    'from_state_id' => $pair[0],
                    'to_state_id' => $pair[1],
                    'created_at' => $now,
                    'updated_at' => $now,
                ], array_values($wanted)));
            }

            $saved->initial_state_id = $ids[$valid['initial_state_id']];
            $saved->save();

            // the relations as they are now, not as they were read before the writes
            $saved->load(['states', 'transitions']);

            if ($current !== null) {
                // Auto-Close of a project whose state went (or stopped being canceled) follows: to the state that takes
                // the old one over when that is canceled, else to the first Canceled state, else off (K11)
                /** @var array<string, string> $mapping removed state → key of the input, checked above */
                $mapping = $valid['state_mapping'];
                $taken = array_map(fn (string $key) => $ids[$key], $mapping);

                foreach (FollowWorkflow::strayed($saved) as $project) {
                    FollowWorkflow::run($actor, $project, $taken, $saved, RemapStates::STATE_REMOVED);
                }
            }

            if ($before === null) {
                EventRecorder::record(EventType::WorkflowCreated, $actor, $saved, null, ['name' => ['old' => null, 'new' => $saved->name]]);

                return $saved;
            }

            $changes = CatalogInput::changes($before, self::snapshot($saved));

            if ($changes !== []) {
                if (! $saved->wasChanged()) {
                    // only states or transitions changed: the workflow changed all the same
                    $saved->touch();
                }

                EventRecorder::record(EventType::WorkflowUpdated, $actor, $saved, null, $changes);
            }

            return $saved;
        });
    }

    /**
     * What an event compares: the fields, the states in order and the transitions as sorted pairs.
     *
     * @return array{name: string, description: string, is_default: bool, is_free: bool, initial_state_id: ?string, states: list<array{id: string, name: string, icon: string, category: string}>, transitions: list<array{0: string, 1: string}>}
     */
    private static function snapshot(Workflow $workflow): array
    {
        $states = array_values($workflow->states->map(fn (WorkflowState $state) => [
            'id' => $state->id, 'name' => $state->name, 'icon' => $state->icon->value, 'category' => $state->category->value,
        ])->all());
        $transitions = array_values($workflow->transitions->map(
            fn (WorkflowTransition $transition) => [$transition->from_state_id, $transition->to_state_id],
        )->all());
        sort($transitions);

        return [
            'name' => $workflow->name,
            'description' => $workflow->description,
            'is_default' => $workflow->is_default,
            'is_free' => $workflow->is_free,
            'initial_state_id' => $workflow->initial_state_id,
            'states' => $states,
            'transitions' => $transitions,
        ];
    }
}
