<?php

namespace App\Actions\WorkItems;

use App\Access\Permission;
use App\Access\Visibility;
use App\Domain\Automations\AutomationKey;
use App\Exceptions\Problem;
use App\Models\RelationType;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Support\Actor;
use App\Support\ProjectAutomations;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;
use RuntimeException;

/**
 * The automation `link_references` (A452, A453): relates an item to the items a change of its texts named anew, with the
 * built-in type `relates`, after the commit of that change (LinkReferencesJob). A system action: the item afresh (gone:
 * nothing) with the automation still on in its project. The writer (the account that wrote, or the person a bot wrote
 * for: who pressed „Jetzt ausführen“ on a template; a scheduled run is the default bot on purpose, it acts for nobody)
 * must still be allowed to change the item (`item.edit`, the same right a relation by hand needs: a viewer who may
 * comment relates nothing), and each target is related only while the writer still sees it. Then AddRelation in a
 * transaction of its own per target (ItemLock::pair, the same order of locks and the same retries, an event at each
 * end, `updated_at` of both, an archived target as the passive end). A pair related with `relates` already in either
 * direction is passed over (AddRelation checks the other direction only for a symmetric type, and `relates` could
 * have been given an inward label). What AddRelation refuses (the pair related already, the item itself, a source or
 * its project archived, an end gone, a project being deleted) it passes over without a word; anything else throws, and
 * the job tries again (a relation it made already is then a duplicate). Should `relates` be gone, it relates nothing
 * and reports that once.
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
        $source = WorkItem::query()->with('project')->find($itemId);
        if ($source === null || ProjectAutomations::enabled($source->project_id, AutomationKey::LinkReferences) === null) {
            return 0;
        }

        $relates = RelationType::query()->where('built_in', 'relates')->value('id');
        if ($relates === null) {
            report(new RuntimeException('The built-in relation type relates is gone: link_references relates nothing.'));

            return 0;
        }

        $writer = User::query()->findOrFail($writerId);
        Visibility::forget();
        if (! Visibility::can($writer, Permission::ItemEdit, $source->project)) {
            return 0;
        }

        $made = 0;
        foreach ($targetIds as $id) {
            $target = WorkItem::query()->with('project')->find($id);
            if ($target === null || Visibility::roleIn($writer, $target->project) === null || self::related($relates, $source, $target)) {
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

    /** Whether the pair has a relation of the type in either direction. */
    private static function related(string $type, WorkItem $a, WorkItem $b): bool
    {
        return WorkItemRelation::query()->where('type_id', $type)
            ->where(fn ($query) => $query->where(fn ($q) => $q->where('source_id', $a->id)->where('target_id', $b->id))
                ->orWhere(fn ($q) => $q->where('source_id', $b->id)->where('target_id', $a->id)))
            ->exists();
    }
}
