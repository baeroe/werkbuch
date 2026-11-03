<?php

namespace App\Actions\Comments;

use App\Access\Authorize;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Comment;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use App\Support\Actor;
use App\Support\AttachmentLinks;
use App\Support\CommentInput;
use App\Support\ItemLock;
use App\Support\Mentions;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Adds a comment to a work item (`POST /api/v1/work-items/{item}/comments`, spec 4.10): whoever reads the item
 * (`item.comment`, viewers and outsiders of a public project too, bots through their tokens). The text is read through
 * the rules of saving before any lock (CommentInput); then the locks of P1 (ItemLock::take), an archived project or item
 * takes no comment (409 `project_archived`, `archived`, A240). The writer's uploads the text names become the comment's
 * (AttachmentLinks).
 *
 * A person who comments watches the item (reason `commented`) without lifting an opt-out (A246); who the comment
 * mentions watches it with an opt-out lifted (Mentions), and a mentioned bot gets `bot.mentioned` with the comment.
 * `comment.created` hangs on the item (A227) with `meta.comment_id` and `meta.mentioned` (only when it names somebody).
 * A comment changes nothing of the item: its `updated_at` stays (P1).
 */
final class AddComment
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `body` (Markdown) or `body_json` (Tiptap JSON)
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, WorkItem $item, array $input): Comment
    {
        Authorize::check($actor, 'create', Comment::class, $item);

        // reading Markdown is the expensive step: never under a lock
        [$body, $key] = CommentInput::body($input, $item->project, $actor->user, null);

        $comment = DB::transaction(function () use ($actor, $item, $body, $key): Comment {
            $locked = ItemLock::take($item);
            ItemLock::refuseArchived($locked);

            $comment = Comment::query()->create([
                'work_item_id' => $locked->id,
                'author_id' => $actor->user->id,
                'body' => $body->toJson(),
                'body_text' => $body->toText(),
            ]);
            AttachmentLinks::link($comment, $locked->project, $actor->user, [$key => $body]);

            if ($actor->user->isPerson()) {
                // an existing row stays as it is: an opt-out above all (A246)
                WorkItemSubscriber::query()->firstOrCreate(['work_item_id' => $locked->id, 'user_id' => $actor->user->id], ['reason' => 'commented']);
            }
            $mentioned = ['comment' => Mentions::after($locked, [], $body->mentionedUserIds(), $actor->user)];

            EventRecorder::record(EventType::CommentCreated, $actor, $locked, $locked->project, null, ['comment_id' => $comment->id] + Mentions::meta($mentioned));
            UpdateWorkItem::announceBots($actor, $locked, $mentioned, $comment->id);

            return $comment;
        }, 3);

        Comment::loadForResource($comment, $actor->user);

        return $comment;
    }
}
