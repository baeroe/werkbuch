<?php

namespace App\Actions\Comments;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Comment;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One comment (`GET /api/v1/comments/{comment}`) for whoever sees its item; everybody else gets the 404 of an unknown
 * one.
 */
final class GetComment
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, Comment $comment): Comment
    {
        Authorize::check($actor, 'view', $comment);

        Comment::loadForResource($comment, $actor->user);

        return $comment;
    }
}
