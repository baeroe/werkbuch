<?php

namespace App\Actions\Attachments;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AttachmentFiles;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes an attachment (`DELETE /api/v1/attachments/{attachment}`, A238). A file of the file list of an item: whoever
 * may change the item (`item.edit`), not in an archived project or item; `work_item.updated` names it and the item gets a
 * new `updated_at`. An upload nobody owns yet: only the person who uploaded it, without an event. A picture or file of
 * a text (`inline` with an owner) never: it goes with its text, or with app:prune-attachments (409 `attachment_inline`).
 * What the account must not read is the 404 of an unknown attachment. The row is read afresh under the lock: one that
 * another request deleted meanwhile is a 404 without a second event, an upload a text linked meanwhile is a picture of
 * that text (K13). The file goes after the commit (AttachmentFiles, K12).
 */
final class DeleteAttachment
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, Attachment $attachment): void
    {
        Authorize::check($actor, 'view', $attachment);

        if ($attachment->attachable_id === null) {
            // an upload nobody owns: AttachmentPolicy::view lets only the person who uploaded it through
            DB::transaction(function () use ($attachment): void {
                self::remove(self::fresh($attachment));
            }, 3);

            return;
        }

        self::refuseInline($attachment);

        $item = $attachment->attachable instanceof WorkItem ? $attachment->attachable : throw Problem::notFound();
        Authorize::check($actor, 'update', $item);

        DB::transaction(function () use ($actor, $attachment, $item): void {
            $item = ItemLock::take($item);
            $project = $item->project;

            if ($project->archived_at !== null) {
                throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
            }
            if ($item->archived_at !== null) {
                throw Problem::conflict('archived', [], __('problem.detail.item_archived', ['key' => $item->key]));
            }

            $attachment = self::fresh($attachment);
            self::remove($attachment);

            $item->touch();
            EventRecorder::record(EventType::WorkItemUpdated, $actor, $item, $project, [
                'attachments' => ['old' => ['id' => $attachment->id, 'filename' => $attachment->filename], 'new' => null],
            ]);
        }, 3);
    }

    /**
     * The row afresh under `for update`: gone → 404; an upload that a text linked meanwhile → 409.
     *
     * @throws Problem
     */
    private static function fresh(Attachment $attachment): Attachment
    {
        $fresh = Attachment::query()->lockForUpdate()->find($attachment->id) ?? throw Problem::notFound();
        self::refuseInline($fresh);

        return $fresh;
    }

    /**
     * A picture or file of a text never goes on its own.
     *
     * @throws Problem
     */
    private static function refuseInline(Attachment $attachment): void
    {
        if ($attachment->kind === 'inline' && $attachment->attachable_id !== null) {
            throw Problem::conflict('attachment_inline', [], __('problem.detail.attachment_inline'));
        }
    }

    private static function remove(Attachment $attachment): void
    {
        AttachmentFiles::removeAfterCommit(collect([$attachment]));
        // the query builder, never $attachment->delete(): medialibrary would remove the file before the commit (K12)
        Attachment::query()->whereKey($attachment->id)->delete();
    }
}
