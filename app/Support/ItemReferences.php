<?php

namespace App\Support;

use App\Actions\WorkItems\LinkReferences;
use App\Domain\Automations\AutomationKey;
use App\Jobs\LinkReferencesJob;
use App\Models\WorkItem;
use App\RichText\Document;

/**
 * Which items a change of a text of an item names anew (A452): a reference of kind `item` the text has now and the
 * texts of the item did not have before, like Mentions does for people. With the automation `link_references` switched
 * on in the project of the item, a job relates the item to them after the commit of the change (A453: a rollback never
 * queues it; the relations take locks of their own, item pair by item pair, outside the transaction of the change).
 * Wiki pages have no item and relate nothing.
 */
final class ItemReferences
{
    /**
     * The items the texts of an item name: its description and its rich text values (from the loaded
     * `values.property`), like Mentions::ofItem().
     *
     * @return list<string>
     */
    public static function ofItem(WorkItem $item): array
    {
        $texts = ItemValues::documentsOf($item);
        if ($item->description !== null) {
            $texts[] = Document::fromJson($item->description);
        }

        return array_values(array_unique(array_merge([], ...array_map(fn (Document $text) => $text->itemRefs(), array_values($texts)))));
    }

    /**
     * The items the sent texts name that `$before` does not, in the order of the texts, without repeats and without the
     * item itself.
     *
     * @param  list<string>  $before
     * @param  array<string, Document>  $texts  by the key that sent them (`description`, `values.<key>`, `body_json`, …)
     * @return list<string>
     */
    public static function anew(WorkItem $item, array $before, array $texts): array
    {
        $named = array_merge([], ...array_map(fn (Document $text) => $text->itemRefs(), array_values($texts)));

        return array_values(array_diff(array_unique($named), $before, [$item->id]));
    }

    /**
     * Queues the job that relates the item to the items, after the commit, when there are any and the automation of the
     * project is on (one query). The job carries IDs only: who wrote, for whom the automation acts, whether quietly.
     *
     * @param  list<string>  $ids
     */
    public static function queue(Actor $actor, WorkItem $item, array $ids): void
    {
        if ($ids === [] || ProjectAutomations::enabled($item->project_id, AutomationKey::LinkReferences) === null) {
            return;
        }

        $automation = Actor::automationFor(LinkReferences::REASON, $actor);

        LinkReferencesJob::dispatch($item->id, $ids, $actor->user->id, $automation->onBehalfOf, $automation->quiet)->afterCommit();
    }
}
