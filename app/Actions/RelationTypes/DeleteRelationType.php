<?php

namespace App\Actions\RelationTypes;

use App\Access\Authorize;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\RelationType;
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a relation type of the organization's own with its relations (org admins); the three built-in ones stay (spec
 * 4.9). Returns the number of relations it took along, always 0 until there are items (Phase 4 counts them, P5). The
 * event names the type in `meta.name`: the subject is gone afterwards.
 */
final class DeleteRelationType
{
    use AsAction;

    /**
     * @throws Problem 409 `built_in`, 404 for a relation type deleted meanwhile
     */
    public function handle(Actor $actor, RelationType $type): int
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::RelationTypes);

        return DB::transaction(function () use ($actor, $type): int {
            CatalogLock::take();

            $type = RelationType::query()->find($type->id) ?? throw Problem::notFound();

            if ($type->built_in !== null) {
                throw Problem::conflict('built_in', detail: __('problem.detail.built_in', ['name' => $type->name]));
            }

            EventRecorder::record(EventType::RelationTypeDeleted, $actor, $type, null, meta: ['name' => $type->name]);
            $type->delete();

            return 0;
        });
    }
}
