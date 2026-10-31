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
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a resolution (org admins). Never the default of a category: each one keeps exactly one (P20). Phase 4 archives
 * a resolution that items carry instead and answers `archived` (P5). The event names the resolution in `meta.label`: the
 * subject is gone afterwards.
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

            EventRecorder::record(EventType::ResolutionDeleted, $actor, $resolution, null, meta: ['label' => $resolution->label]);
            $resolution->delete();

            return ['outcome' => 'deleted'];
        });
    }
}
