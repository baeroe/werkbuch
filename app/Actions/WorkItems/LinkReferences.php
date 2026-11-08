<?php

namespace App\Actions\WorkItems;

use App\Access\Visibility;
use App\Domain\Automations\AutomationKey;
use App\Exceptions\Problem;
use App\Models\RelationType;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ProjectAutomations;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The automation `link_references` (A452, A453): relates an item to the items a change of its texts named anew, with the
 * built-in symmetric type `relates`, after the commit of that change (LinkReferencesJob). A system action: the item
 * afresh (gone: nothing) with the automation still on in its project; each target only while the account that wrote
 * still sees it, then AddRelation in a transaction of its own (ItemLock::pair, the same order of locks and the same
 * retries, an event at each end, `updated_at` of both, an archived target as the passive end). What AddRelation refuses
 * (the pair related already in either direction, the item itself, a source or its project archived, an end gone, a
 * project being deleted) it passes over without a word; anything else throws, and the job tries again (a relation it
 * made already is then a duplicate).
 */
final class LinkReferences
{
    use AsAction;

    /** The reason of the events of the relations (`meta.reason`) and the name of the automation. */
    public const REASON = 'link_references';

    /**
     * @param  list<string>  $targetIds
     * @return int the relations it made
     */
    public function handle(Actor $actor, string $itemId, array $targetIds, string $writerId): int
    {
        $source = WorkItem::query()->find($itemId);
        if ($source === null || ProjectAutomations::enabled($source->project_id, AutomationKey::LinkReferences) === null) {
            return 0;
        }

        $writer = User::query()->findOrFail($writerId);
        $relates = RelationType::query()->where('built_in', 'relates')->value('id');
        Visibility::forget();
        $made = 0;

        foreach ($targetIds as $id) {
            $target = WorkItem::query()->with('project')->find($id);
            if ($target === null || Visibility::roleIn($writer, $target->project) === null) {
                continue;
            }

            try {
                AddRelation::run($actor, $source, ['type_id' => $relates, 'target_id' => $target->id]);
                $made++;
            } catch (ValidationException|Problem) {
                // related already, the item itself, archived, gone or being deleted: nothing to relate
            }
        }

        return $made;
    }
}
