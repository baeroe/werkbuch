<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Actions\Automations\FollowWorkflow;
use App\Actions\Workflows\ListStateUsage;
use App\Actions\WorkItems\RemapStates;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Support\Actor;
use App\Support\CatalogLock;
use App\Support\MemberInput;
use App\Support\ProjectInput;
use App\Support\WorkflowInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Switches the workflow of a project (its admins, spec 4.5): `workflow_id` and a `mapping` of the states, state of the
 * old workflow → state of the new one. Every state of the old workflow that an item of the project stands in (archived
 * ones too) needs a target, else 422 at `mapping.<state_id>` with the states and their items in `extensions.states`; a
 * mapping of a state without items is taken without complaint. The items move in the same transaction (RemapStates,
 * `workflow_changed`), and Auto-Close follows into a Canceled state of the new workflow (FollowWorkflow), both before
 * the `project.updated`. Runs under the catalog lock, then the lock of the project row
 * (organization before project): the workflow cannot be deleted while the project gets it, two switches of one project
 * run one after the other, and every change of an item (which shares the catalog lock) waits for the switch and then
 * finds its item in the new workflow. The same workflow again changes nothing and records nothing.
 */
final class AssignWorkflow
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `workflow_id`, `mapping`
     *
     * @throws ValidationException
     * @throws Problem 422 at `mapping.<state_id>` (with `extensions.states` for states in use without a target), 404 for a project that is being deleted
     */
    public function handle(Actor $actor, Project $project, array $input): Project
    {
        Authorize::check($actor, 'changeWorkflow', $project);

        $input = ProjectInput::normalize($input);

        // no Visibility::forget(): the workflow changes neither who sees the project nor the roles in it (P27)
        return DB::transaction(function () use ($actor, $project, $input): Project {
            CatalogLock::take();
            MemberInput::lock($project);
            $project->refresh();

            /** @var array{workflow_id: string, mapping?: ?array<array-key, mixed>} $valid */
            $valid = Validator::make($input, [
                'workflow_id' => ProjectInput::workflow(),
                'mapping' => ['sometimes', 'nullable', 'array'],
            ], ProjectInput::messages())->validate();

            $old = Workflow::query()->with('states')->findOrFail($project->workflow_id);
            $new = Workflow::query()->with('states')->findOrFail($valid['workflow_id']);

            $states = fn (Workflow $workflow): array => array_values($workflow->states->map(fn (WorkflowState $state) => $state->id)->all());
            $errors = WorkflowInput::mappingErrors('mapping', $valid['mapping'] ?? [], $states($old), $states($new));

            if ($errors !== []) {
                throw Problem::invalid($errors);
            }

            if ($new->id === $old->id) {
                return $project;
            }

            // every state an item of the project stands in (archived ones too) needs a state in the new workflow
            $unmapped = WorkflowInput::unmapped($valid['mapping'] ?? [], $old->states, ListStateUsage::counts([$project->id]));

            if ($unmapped !== []) {
                $errors = [];

                foreach ($unmapped as $state) {
                    $errors["mapping.{$state['state_id']}"] = [__('field.mapping.required', ['name' => $state['name']])];
                }

                throw Problem::unprocessable('validation_failed', $errors, ['states' => $unmapped]);
            }

            /** @var array<string, string> $mapping keys and targets checked above */
            $mapping = $valid['mapping'] ?? [];
            RemapStates::run($actor, [$project->id], $mapping, RemapStates::WORKFLOW_CHANGED);
            // Auto-Close follows into a Canceled state of the new workflow, or switches off (K11)
            FollowWorkflow::run($actor, $project, $mapping, $new, RemapStates::WORKFLOW_CHANGED);

            $project->update(['workflow_id' => $new->id]);
            EventRecorder::record(EventType::ProjectUpdated, $actor, $project, $project, ['workflow_id' => ['old' => $old->id, 'new' => $new->id]]);

            return $project;
        });
    }
}
