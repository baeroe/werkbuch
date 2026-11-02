<?php

namespace App\Actions\Comments;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Models\Comment;
use App\Support\Actor;
use App\Support\AttachmentFiles;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a comment (`DELETE /api/v1/comments/{comment}`, spec 4.10): its author, the admins of the project and org
 * admins (A241), not in an archived project or item (A240). Under the item's lock the comment is read afresh: one
 * deleted meanwhile is a 404 without a second event. Its reactions go with it (cascade), its pictures and files as well,
 * their files only after the commit (AttachmentFiles, K12). `comment.deleted` keeps no text (A228), only which comment
 * and whose it was.
 */
final class DeleteComment
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, Comment $comment): void
    {
        Authorize::check($actor, 'delete', $comment);

        DB::transaction(function () use ($actor, $comment): void {
            $locked = ItemLock::take($comment->workItem);
            $fresh = Comment::query()->lockForUpdate()->find($comment->id) ?? throw Problem::notFound();
            AddComment::refuseArchived($locked);

            $attachments = $fresh->attachments()->lockForUpdate()->get();
            AttachmentFiles::removeAfterCommit($attachments);
            // the query builder, never $attachment->delete(): medialibrary would remove the files before the commit (K12)
            Attachment::query()->whereKey($attachments->modelKeys())->delete();
            $fresh->delete();

            EventRecorder::record(EventType::CommentDeleted, $actor, $locked, $locked->project, null, [
                'comment_id' => $fresh->id,
                'author_id' => $fresh->author_id,
            ]);
        }, 3);
    }
}
