<?php

namespace App\Actions\WorkItemTypes;

use App\Access\Authorize;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Project;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Support\Actor;
use App\Support\CatalogLock;
use App\Support\TypeInput;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a work item type with the properties it asks for and takes it out of the projects that had it switched on
 * (org admins). Never the default type of a project (P11). The cascade writes no event of its own: `work_item_type.deleted`
 * names the projects in `meta.projects` (P26). A type that items carry is archived instead (spec 4.6): it stays on in
 * the projects and keeps its items, only no new item gets it.
 */
final class DeleteWorkItemType
{
    use AsAction;

    /**
     * @return array{outcome: string}
     *
     * @throws Problem 409 `default_type` with the identifiers of the projects, 404 for a type deleted meanwhile
     */
    public function handle(Actor $actor, WorkItemType $type): array
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::WorkItemTypes);

        return DB::transaction(function () use ($actor, $type): array {
            CatalogLock::take();

            $type = WorkItemType::query()->find($type->id) ?? throw Problem::notFound();

            TypeInput::refuseDefaultType($type);

            if (WorkItem::query()->where('type_id', $type->id)->exists()) {
                // archived already (the stamp stays): nothing to write
                if ($type->archived_at === null) {
                    $type->archived_at = now();
                    $type->save();

                    EventRecorder::record(EventType::WorkItemTypeUpdated, $actor, $type, null, [
                        'archived_at' => ['old' => null, 'new' => $type->archived_at->toJSON()],
                    ]);
                }

                return ['outcome' => 'archived'];
            }

            $projects = Project::query()
                ->whereHas('types', fn ($query) => $query->whereKey($type->id))
                ->orderBy('name')->orderBy('id')->pluck('identifier')->all();

            EventRecorder::record(EventType::WorkItemTypeDeleted, $actor, $type, null, meta: ['name' => $type->name, 'projects' => $projects]);
            $type->delete();

            return ['outcome' => 'deleted'];
        });
    }
}
