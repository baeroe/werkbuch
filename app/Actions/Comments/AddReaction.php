<?php

namespace App\Actions\Comments;

use App\Access\Authorize;
use App\Domain\Emoji;
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
 * Reacts to a comment with an emoji (`PUT /api/v1/comments/{comment}/reactions`, spec 4.10): whoever may comment
 * (`CommentPolicy::react`, viewers too). `emoji` is required and exactly one emoji (`Emoji::is`, else 422
 * `field.emoji.invalid`). Under the item's lock without the organisation, like watching (P1), the comment is read
 * afresh (gone: 404) and an archived project or item refuses it (409, A240). One person gives an emoji once: a second
 * time changes nothing and records no event. 👍 and 👍🏽 are two emojis (byte-wise column, P14). The reply is the
 * comment with its reactions.
 */
final class AddReaction
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
        $emoji = self::emoji($input);

        $fresh = DB::transaction(function () use ($actor, $comment, $emoji): Comment {
            $locked = ItemLock::take($comment->workItem, false);
            $fresh = Comment::query()->lockForUpdate()->find($comment->id) ?? throw Problem::notFound();
            AddComment::refuseArchived($locked);

            $given = CommentReaction::query()->where(['comment_id' => $fresh->id, 'user_id' => $actor->user->id, 'emoji' => $emoji])->exists();
            if (! $given) {
                // a plain create: HasUlids gives the id (insertOrIgnore would write '' and swallow errors, K16)
                CommentReaction::query()->create(['comment_id' => $fresh->id, 'user_id' => $actor->user->id, 'emoji' => $emoji]);
                EventRecorder::record(EventType::CommentReactionAdded, $actor, $locked, $locked->project, null, [
                    'comment_id' => $fresh->id,
                    'emoji' => $emoji,
                ]);
            }

            return $fresh;
        }, 3);

        Comment::loadForResource($fresh, $actor->user);

        return $fresh;
    }

    /**
     * The one emoji of the input, shared with RemoveReaction.
     *
     * @param  array<array-key, mixed>  $input
     *
     * @throws ValidationException
     */
    public static function emoji(array $input): string
    {
        $emoji = $input['emoji'] ?? null;
        if (! is_string($emoji) || ! Emoji::is($emoji)) {
            throw ValidationException::withMessages(['emoji' => __('field.emoji.invalid')]);
        }

        return $emoji;
    }
}
