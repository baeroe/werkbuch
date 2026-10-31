<?php

namespace App\Actions\Workflows;

use App\Access\Authorize;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkflowTransition;
use App\Support\Actor;
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
 * Everything runs under the catalog lock, one change of the catalog at a time, each from what the one before left.
 * Only what really changes is written and recorded; the same input again writes nothing.
 */
final class SaveWorkflow
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `name`, `description`, `is_default`, `is_free`, `initial_state_id`, `states`, `transitions`, `state_mapping`
     *
     * @throws ValidationException
     * @throws Problem 422 `invalid_workflow`, 404 for a workflow deleted meanwhile
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

            // only its form counts until there are items to move (Phase 4, P5)
            $mappingErrors = WorkflowInput::mappingErrors('state_mapping', $valid['state_mapping'], $removed, $keys);

            if ($mappingErrors !== []) {
                throw Problem::invalid($mappingErrors);
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

            // the transitions only between its own states: those that stay are kept, the others go, the missing ones come
            $wanted = [];

            foreach ($valid['transitions'] as [$from, $to]) {
                $wanted[$ids[$from]."\n".$ids[$to]] = [$ids[$from], $ids[$to]];
            }

            foreach ($current === null ? [] : $current->transitions as $transition) {
                $pair = $transition->from_state_id."\n".$transition->to_state_id;

                if (isset($wanted[$pair])) {
                    unset($wanted[$pair]);
                } else {
                    $transition->delete();
                }
            }

            if ($removed !== []) {
                WorkflowState::query()->whereKey($removed)->delete();
            }

            foreach ($wanted as [$from, $to]) {
                WorkflowTransition::query()->create(['workflow_id' => $saved->id, 'from_state_id' => $from, 'to_state_id' => $to]);
            }

            $saved->initial_state_id = $ids[$valid['initial_state_id']];
            $saved->save();

            // the relations as they are now, not as they were read before the writes
            $saved->load(['states', 'transitions']);

            if ($before === null) {
                EventRecorder::record(EventType::WorkflowCreated, $actor, $saved, null, ['name' => ['old' => null, 'new' => $saved->name]]);

                return $saved;
            }

            $changes = [];

            foreach (self::snapshot($saved) as $field => $new) {
                if ($before[$field] !== $new) {
                    $changes[$field] = ['old' => $before[$field], 'new' => $new];
                }
            }

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
