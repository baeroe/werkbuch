<?php

namespace App\Actions\Labels;

use App\Access\Authorize;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Label;
use App\Models\Organization;
use App\Models\WorkItemLabel;
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a label and takes it off the items (org admins). Returns the number of items that had it (read under the
 * catalog lock, before the cascade takes the labels off). The event names the label in `meta.name` (the subject is gone
 * afterwards) and those items in `meta.item_ids` (all of them, in id order): the cascade writes no event of theirs, the
 * search reindexes them (A206).
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

            /** @var list<string> $items */
            $items = WorkItemLabel::query()->where('label_id', $label->id)->orderBy('work_item_id')->pluck('work_item_id')->all();

            EventRecorder::record(EventType::LabelDeleted, $actor, $label, null, meta: ['name' => $label->name, 'item_ids' => $items]);
            $label->delete();

            return count($items);
        });
    }
}
