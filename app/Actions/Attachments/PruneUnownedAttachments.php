<?php

namespace App\Actions\Attachments;

use App\Models\Attachment;
use App\Support\Actor;
use App\Support\AttachmentFiles;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Removes uploads nobody owns (a picture pasted into a text that was never saved, A232) that are older than `$before`:
 * the hourly job PruneUnownedAttachmentsJob passes 24 hours ago (spec 4.16, A239). In blocks of BLOCK, each in a
 * transaction of its own that reads its rows afresh `for update` (a text that linked an upload meanwhile keeps it; a
 * link waits for the block and finds the upload gone, AttachmentLinks); the files go after each commit (K12). No event:
 * an upload nobody owns was never anything anybody saw (A238, A239).
 */
final class PruneUnownedAttachments
{
    use AsAction;

    /** The rows of one transaction. */
    public const BLOCK = 200;

    /**
     * @return int how many uploads went
     */
    public function handle(Actor $actor, CarbonInterface $before): int
    {
        $pruned = 0;

        self::unowned($before)->select('id')->chunkById(self::BLOCK, function (Collection $block) use ($before, &$pruned): void {
            $pruned += DB::transaction(function () use ($block, $before): int {
                $rows = self::unowned($before)->whereKey($block->modelKeys())->lockForUpdate()->get();

                AttachmentFiles::removeAfterCommit($rows);
                Attachment::query()->whereKey($rows->modelKeys())->delete();

                return $rows->count();
            }, 3);
        });

        return $pruned;
    }

    /**
     * @return Builder<Attachment>
     */
    private static function unowned(CarbonInterface $before): Builder
    {
        // both are empty for an upload nobody owns (AttachmentLinks sets both): the morph index carries the scan
        return Attachment::query()->whereNull('attachable_type')->whereNull('attachable_id')->where('created_at', '<', $before);
    }
}
