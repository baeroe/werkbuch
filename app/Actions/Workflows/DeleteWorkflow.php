<?php

namespace App\Actions\Workflows;

use App\Access\Authorize;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Workflow;
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a workflow with its states and transitions (org admins). Never the default one, and never one a project uses:
 * archived projects and projects being deleted count too, their row holds the workflow until it is purged. Checked
 * under the catalog lock, so no project gets the workflow while it goes.
 */
final class DeleteWorkflow
{
    use AsAction;

    /**
     * @throws Problem 409 `default_workflow`, 409 `in_use` with the identifiers of the projects, 404 for a workflow deleted meanwhile
     */
    public function handle(Actor $actor, Workflow $workflow): void
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::Workflows);

        DB::transaction(function () use ($actor, $workflow): void {
            CatalogLock::take();

            $workflow = Workflow::query()->find($workflow->id) ?? throw Problem::notFound();

            if ($workflow->is_default) {
                throw Problem::conflict('default_workflow', detail: __('problem.detail.default_workflow'));
            }

            $projects = Project::query()->where('workflow_id', $workflow->id)->orderBy('name')->orderBy('id')->pluck('identifier')->all();

            if ($projects !== []) {
                throw Problem::conflict('in_use', ['projects' => $projects], __('problem.detail.workflow_in_use', ['projects' => implode(', ', $projects)]));
            }

            EventRecorder::record(EventType::WorkflowDeleted, $actor, $workflow, null, meta: ['name' => $workflow->name]);
            $workflow->delete();
        });
    }
}
