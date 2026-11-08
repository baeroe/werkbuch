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
 * an index instead of reading every text. CreatePage, UpdatePage (with a text that changes) and RestorePageVersion call
 * sync() under the lock of the page; a row goes with its page and with its item (cascade). No event, no history.
 */
final class PageItemReferences
{
    /**
     * Puts the rows of the page right for its text: rows of items the text no longer names go, rows of items it names,
     * there are and the page has no row for yet come in (only the missing ones: a row there is stays untouched). The
     * items there are come from one read without a lock, the new rows with `insertOrIgnore` and IDs given before: an
     * item deleted between the read and the write leaves no row (its foreign key fails and is ignored). The check of
     * that foreign key holds a shared lock on the item up to the commit: a deletion of the item waits for a page that
     * names it anew, never the other way round, and the callers sync before they link the attachments (items before
     * attachments, as DeleteWorkItem takes them).
     */
    public static function sync(Page $page, ?Document $content): void
    {
        $named = $content?->itemRefs() ?? [];
        $there = $named === [] ? [] : WorkItem::query()->whereKey($named)->pluck('id')->all();

        PageItemReference::query()->where('page_id', $page->id)
            ->when($there !== [], fn ($query) => $query->whereNotIn('work_item_id', $there))
            ->delete();

        $missing = $there === [] ? [] : array_values(array_diff(
            $there,
            PageItemReference::query()->where('page_id', $page->id)->pluck('work_item_id')->all(),
        ));
        if ($missing !== []) {
            PageItemReference::query()->insertOrIgnore(array_map(
                fn (string $id) => ['id' => strtolower((string) Str::ulid()), 'page_id' => $page->id, 'work_item_id' => $id],
                $missing,
            ));
        }
    }
}
