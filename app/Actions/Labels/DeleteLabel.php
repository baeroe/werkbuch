<?php

namespace App\Actions\Labels;

use App\Access\Authorize;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Label;
use App\Models\Organization;
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a label and takes it off the items (org admins). Returns the number of items that had it, always 0 until
 * there are items (Phase 4 counts them, P5). The event names the label in `meta.name`: the subject is gone afterwards.
 */
final class DeleteLabel
{
    use AsAction;

    /**
     * @throws Problem 404 for a label deleted meanwhile
     */
    public function handle(Actor $actor, Label $label): int
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::Labels);

        return DB::transaction(function () use ($actor, $label): int {
            CatalogLock::take();

            $label = Label::query()->find($label->id) ?? throw Problem::notFound();

            EventRecorder::record(EventType::LabelDeleted, $actor, $label, null, meta: ['name' => $label->name]);
            $label->delete();

            return 0;
        });
    }
}
