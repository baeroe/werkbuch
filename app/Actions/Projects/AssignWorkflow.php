<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
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
 * old workflow → state of the new one. Phase 3 has no items, so only the form of the mapping counts (P5); Phase 4 asks
 * for a state for every state that holds items and moves them (`RemapStates`). Runs under the catalog lock, then the
 * lock of the project row (organization before project): the workflow cannot be deleted while the project gets it, and
 * two switches of one project run one after the other. The same workflow again changes nothing and records nothing.
 */
final class AssignWorkflow
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `workflow_id`, `mapping`
     *
     * @throws ValidationException
     * @throws Problem 422 at `mapping.<state_id>`, 404 for a project that is being deleted
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

            $project->update(['workflow_id' => $new->id]);
            EventRecorder::record(EventType::ProjectUpdated, $actor, $project, $project, ['workflow_id' => ['old' => $old->id, 'new' => $new->id]]);

            return $project;
        });
    }
}
