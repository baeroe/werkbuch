<?php

use App\RichText\Document;
use App\RichText\InvalidDocument;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

// Which page names which item (Phase 15, Task 21t, A456): a row per reference of kind `item` in the current text of a
// page (never a version, never a key written as text), kept by CreatePage, UpdatePage and RestorePageVersion
// (PageItemReferences::sync). A row goes with its page and with its item (cascade: DeletePage, DeleteWorkItem and
// PurgeProject need no code of their own). The unique key is the first index that starts with `page_id`, on purpose:
// InnoDB carries the foreign key on it, and no column in it changes through a `set null` (see `pages`). The second index
// answers „which pages name this item“ (Task 21u). The pages there are fill the table in blocks of 500 (only pages with
// a reference node are read); a text Document refuses names nothing, an item that is gone gets no row.
return new class extends Migration
{
    /** Items read and rows written per statement: 3 000 rows of three columns stay far below 65 535 placeholders. */
    private const SLICE = 3_000;

    public function up(): void
    {
        Schema::create('page_item_references', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('page_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('work_item_id')->constrained()->cascadeOnDelete();

            $table->unique(['page_id', 'work_item_id']);
            $table->index(['work_item_id', 'page_id']);
        });

        DB::table('pages')->select(['id', 'content'])->where('content', 'like', '%"reference"%')
            ->chunkById(500, fn (Collection $pages) => $this->fill($pages));
    }

    public function down(): void
    {
        Schema::dropIfExists('page_item_references');
    }

    /**
     * The rows of a block of pages: the items each text references, only those there are (one read per block).
     *
     * @param  Collection<int, stdClass>  $pages  `id` and the stored `content`
     */
    private function fill(Collection $pages): void
    {
        $named = [];
        foreach ($pages as $page) {
            $json = json_decode((string) $page->content, true);
            try {
                $named[(string) $page->id] = is_array($json) ? Document::fromJson($json)->itemRefs() : [];
            } catch (InvalidDocument) {
                $named[(string) $page->id] = [];
            }
        }

        // in slices: a block of long texts can name more items than one statement takes placeholders (65 535)
        $there = [];
        foreach (array_chunk(array_values(array_unique(array_merge([], ...array_values($named)))), self::SLICE) as $ids) {
            $there += array_flip(DB::table('work_items')->whereIn('id', $ids)->pluck('id')->all());
        }

        $rows = [];
        foreach ($named as $pageId => $items) {
            foreach ($items as $itemId) {
                if (isset($there[$itemId])) {
                    $rows[] = ['id' => strtolower((string) Str::ulid()), 'page_id' => $pageId, 'work_item_id' => $itemId];
                }
            }
        }

        foreach (array_chunk($rows, self::SLICE) as $slice) {
            DB::table('page_item_references')->insert($slice);
        }
    }
};
