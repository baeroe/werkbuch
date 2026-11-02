<?php

namespace App\Actions\Comments;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Comment;
use App\Models\CommentReaction;
use App\Support\Actor;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Takes back the own emoji of a comment (`DELETE /api/v1/comments/{comment}/reactions`, `emoji` in the body): never
 * another person's. Same rules and locks as AddReaction; an emoji the person never gave changes nothing and records no
 * event. The reply is the comment with its reactions.
 */
final class RemoveReaction
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `emoji`
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, Comment $comment, array $input): Comment
    {
        Authorize::check($actor, 'react', $comment);
        $emoji = AddReaction::emoji($input);

        $fresh = DB::transaction(function () use ($actor, $comment, $emoji): Comment {
            $locked = ItemLock::take($comment->workItem, false);
            $fresh = Comment::query()->lockForUpdate()->find($comment->id) ?? throw Problem::notFound();
            AddComment::refuseArchived($locked);

            $removed = CommentReaction::query()->where(['comment_id' => $fresh->id, 'user_id' => $actor->user->id, 'emoji' => $emoji])->delete();
            if ($removed > 0) {
                EventRecorder::record(EventType::CommentReactionRemoved, $actor, $locked, $locked->project, null, [
                    'comment_id' => $fresh->id,
                    'emoji' => $emoji,
                ]);
            }

            return $fresh;
        }, 3);

        Comment::loadForResource($fresh, $actor->user);

        return $fresh;
    }
}
