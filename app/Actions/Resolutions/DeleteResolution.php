<?php

namespace App\Actions\Resolutions;

use App\Access\Authorize;
use App\Domain\Workflow\StateCategory;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Resolution;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a resolution (org admins). Never the default of a category: each one keeps exactly one (P20). A resolution that
 * items carry is archived instead and the answer is `archived` (spec 4.6); the items keep it, and a transition or a
 * remap keeps an archived one an item already has (ResolutionRule). A deleted resolution is named in `meta.label` of the
 * event: the subject is gone afterwards.
 */
final class DeleteResolution
{
    use AsAction;

    /**
     * @return array{outcome: string}
     *
     * @throws Problem 409 `is_default`, 404 for a resolution deleted meanwhile
     */
    public function handle(Actor $actor, Resolution $resolution): array
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::Resolutions);

        return DB::transaction(function () use ($actor, $resolution): array {
            CatalogLock::take();

            $resolution = Resolution::query()->find($resolution->id) ?? throw Problem::notFound();

            if ($resolution->default_for !== null) {
                throw Problem::conflict('is_default', detail: __('problem.detail.default_resolution', [
                    'label' => $resolution->label,
                    'category' => StateCategory::from($resolution->default_for)->label(),
                ]));
            }

            if (WorkItem::query()->where('resolution_id', $resolution->id)->exists()) {
                // archived already (the stamp stays): nothing to write
                if ($resolution->archived_at === null) {
                    $resolution->archived_at = now();
                    $resolution->save();

                    EventRecorder::record(EventType::ResolutionUpdated, $actor, $resolution, null, [
                        'archived_at' => ['old' => null, 'new' => $resolution->archived_at->toJSON()],
                    ]);
                }

                return ['outcome' => 'archived'];
            }

            EventRecorder::record(EventType::ResolutionDeleted, $actor, $resolution, null, meta: ['label' => $resolution->label]);
            $resolution->delete();

            return ['outcome' => 'deleted'];
        });
    }
}
