<?php

namespace App\Support;

use App\Models\Page;
use App\Models\PageItemReference;
use App\Models\WorkItem;
use App\RichText\Document;
use Illuminate\Support\Str;

/**
 * Which items a page names (A456): the table `page_item_references` follows the references of kind `item` in the
 * current text of a page (never a version, never a key written as text), so the detail of an item finds its pages over
 * an index instead of reading every text. CreatePage, UpdatePage (with a text that changes) and RestorePageVersion
 * write it under the lock of the page; a row goes with its page and with its item (cascade). No event, no history.
 *
 * The order of the locks is the one of DeleteWorkItem (the item, then its attachments, then by cascade the rows on
 * it): the callers add() the new rows before they link the attachments (the check of a new row's foreign key holds
 * the item) and prune() the old ones after (deleting a row locks it). A save that drops the reference to an item and
 * keeps a picture of it, while the item is deleted, so waits for the picture first and never holds the row the
 * deletion's cascade waits for (21u-M1).
 */
final class PageItemReferences
{
    /** add() and prune() at once, for a writer that links no attachment in between (seeders, tests). */
    public static function sync(Page $page, ?Document $content): void
    {
        self::add($page, $content);
        self::prune($page, $content);
    }

    /**
     * Adds the rows of the items the text names, there are and the page has no row for yet (a row there is stays
     * untouched). The items there are come from one read without a lock, the new rows with `insertOrIgnore` and IDs
     * given before: an item deleted between the read and the write leaves no row (its foreign key fails and is
     * ignored). The check of that foreign key holds a shared lock on the item up to the commit: a deletion of the item
     * waits for a page that names it anew, never the other way round.
     */
    public static function add(Page $page, ?Document $content): void
    {
        $named = $content?->itemRefs() ?? [];
        if ($named === []) {
            return;
        }

        $missing = array_values(array_diff(
            WorkItem::query()->whereKey($named)->pluck('id')->all(),
            PageItemReference::query()->where('page_id', $page->id)->pluck('work_item_id')->all(),
        ));
        if ($missing !== []) {
            PageItemReference::query()->insertOrIgnore(array_map(
                fn (string $id) => ['id' => strtolower((string) Str::ulid()), 'page_id' => $page->id, 'work_item_id' => $id],
                $missing,
            ));
        }
    }

    /** Removes the rows of the items the text no longer names. */
    public static function prune(Page $page, ?Document $content): void
    {
        $named = $content?->itemRefs() ?? [];

        PageItemReference::query()->where('page_id', $page->id)
            ->when($named !== [], fn ($query) => $query->whereNotIn('work_item_id', $named))
            ->delete();
    }
}
