<?php

namespace App\Actions\Setup;

use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Binds the projects of Phase 2 to the catalog: a project without a workflow gets the default workflow, one without
 * switched-on types every active type (P10), one without a default type the first switched-on one. Runs from the
 * migration that makes both columns required, before it does; also projects being deleted count (their row stays until
 * the purge). Idempotent: a project that has all three keeps them. Every project it changes is one `project.updated` of
 * the default bot with what changed.
 */
final class LinkProjectsToCatalog
{
    use AsAction;

    public function handle(): void
    {
        DB::transaction(function (): void {
            CatalogLock::take();

            $actor = Actor::system(User::defaultBot(), 'setup');
            $workflow = Workflow::default()->id;
            $active = WorkItemType::query()->whereNull('archived_at')->orderBy('id')->pluck('id')->all();

            foreach (Project::query()->with('types:work_item_types.id')->orderBy('id')->get() as $project) {
                $before = [
                    'workflow_id' => $project->workflow_id,
                    'enabled_type_ids' => $project->types->modelKeys(),
                    'default_type_id' => $project->default_type_id,
                ];
                $types = $before['enabled_type_ids'] === [] ? $active : $before['enabled_type_ids'];
                $changes = CatalogInput::changes($before, [
                    'workflow_id' => $project->workflow_id ?? $workflow,
                    'enabled_type_ids' => $types,
                    'default_type_id' => $project->default_type_id ?? $types[0],
                ]);

                if ($changes === []) {
                    continue;
                }

                if (isset($changes['enabled_type_ids'])) {
                    $project->types()->sync($types);
                }

                $project->update(array_map(fn (array $change) => $change['new'], array_diff_key($changes, ['enabled_type_ids' => true])));
                EventRecorder::record(EventType::ProjectUpdated, $actor, $project, $project, $changes);
            }
        });
    }
}
