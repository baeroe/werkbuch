<?php

namespace App\Actions\Comments;

use App\Access\Authorize;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Comment;
use App\RichText\Document;
use App\Support\Actor;
use App\Support\AttachmentLinks;
use App\Support\CommentInput;
use App\Support\ItemLock;
use App\Support\Mentions;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Edits a comment (`PATCH /api/v1/comments/{comment}`, spec 4.10): its author only (403 for everybody else, admins
 * included). The text is read through the rules of saving before any lock, with the stored text as the one before (a
 * mention or reference it had stays). Under the item's lock the comment is read afresh: one deleted meanwhile is a 404,
 * an archived project or item a 409 (A240). The same text changes nothing (no event, `edited_at` stays); any other
 * marks the comment edited and records `comment.updated` with the old and new text (A228), the author and who it
 * mentions anew (people watch the item, bots get `bot.mentioned`).
 */
final class EditComment
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `body` (Markdown) or `body_json` (Tiptap JSON)
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, Comment $comment, array $input): Comment
    {
        Authorize::check($actor, 'update', $comment);

        // reading Markdown is the expensive step: never under a lock
        [$body, $key] = CommentInput::body($input, $comment->workItem->project, $actor->user, Document::fromJson($comment->body));

        $comment = DB::transaction(function () use ($actor, $comment, $body, $key): Comment {
            $locked = ItemLock::take($comment->workItem);
            $fresh = Comment::query()->lockForUpdate()->find($comment->id) ?? throw Problem::notFound();
            ItemLock::refuseArchived($locked);

            $old = $fresh->body;
            if ($body->toJson() === $old) {
                return $fresh;
            }

            $fresh->update(['body' => $body->toJson(), 'body_text' => $body->toText(), 'edited_at' => now()]);
            AttachmentLinks::link($fresh, $locked->project, $actor->user, [$key => $body]);
            $mentioned = ['comment' => Mentions::after($locked, Document::fromJson($old)->mentionedUserIds(), $body->mentionedUserIds(), $actor->user)];

            EventRecorder::record(EventType::CommentUpdated, $actor, $locked, $locked->project, ['body' => ['old' => $old, 'new' => $fresh->body]], [
                'comment_id' => $fresh->id,
                'author_id' => $fresh->author_id,
            ] + Mentions::meta($mentioned));
            UpdateWorkItem::announceBots($actor, $locked, $mentioned, $fresh->id);

            return $fresh;
        }, 3);

        Comment::loadForResource($comment, $actor->user);

        return $comment;
    }
}
