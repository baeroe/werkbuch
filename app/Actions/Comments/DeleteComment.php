<?php

namespace App\Actions\Comments;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Comment;
use App\Support\Actor;
use App\Support\AttachmentTexts;
use App\Support\ItemLock;
use App\Support\ReadCommitted;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a comment (`DELETE /api/v1/comments/{comment}`, spec 4.10): its author, the admins of the project and org
 * admins (A241), not in an archived project or item (A240). Under the item's lock the comment is read afresh: one
 * deleted meanwhile is a 404 without a second event. Its reactions go with it (cascade), its pictures and files as well,
 * their files only after the commit (AttachmentFiles, K12); a picture another saved text of the project still names
 * (copied, A233) becomes that text's instead (AttachmentTexts::handOverOrRemove, Ruling T13-I1). `comment.deleted` keeps no text (A228), only which comment
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

        // the texts are read as they are now, after the lock on the attachments (N1, T13-M8)
        ReadCommitted::run(fn () => DB::transaction(function () use ($actor, $comment): void {
            $locked = ItemLock::take($comment->workItem);
            $fresh = Comment::query()->lockForUpdate()->find($comment->id) ?? throw Problem::notFound();
            ItemLock::refuseArchived($locked);

            AttachmentTexts::handOverOrRemove($fresh->attachments()->orderBy('id')->lockForUpdate()->get(), $locked->project_id, [], [$fresh->id]);
            $fresh->delete();

            EventRecorder::record(EventType::CommentDeleted, $actor, $locked, $locked->project, null, [
                'comment_id' => $fresh->id,
                'author_id' => $fresh->author_id,
            ]);
        }, 3));
    }
}
