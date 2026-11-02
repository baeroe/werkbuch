<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\ProjectRole;
use App\Access\Visibility;
use App\Models\Comment;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Auth\Access\Response;

/**
 * Who may do what with comments (spec 4.3, 4.10). A comment of an item the account does not see is always a 404, never
 * a 403; whoever sees the item reads its comments and may comment (`item.comment`, viewers and outsiders of a public
 * project too). Only the author edits a comment; the author, the admins of the project and org admins delete one (A241).
 */
final class CommentPolicy
{
    public function view(User $user, Comment $comment): Response
    {
        return self::sees($user, $comment->workItem) ? Response::allow() : Response::denyAsNotFound();
    }

    /** Commenting on an item: `item.comment` in its project, which every role holds. */
    public function create(User $user, WorkItem $item): Response
    {
        if (! self::sees($user, $item)) {
            return Response::denyAsNotFound();
        }

        return Visibility::can($user, Permission::ItemComment, $item->project) ? Response::allow() : Response::deny(__('problem.detail.comment_readers_only'));
    }

    /** Editing a comment: its author only, as long as they may comment in the project; an admin is refused as well. */
    public function update(User $user, Comment $comment): Response
    {
        if (! self::sees($user, $comment->workItem)) {
            return Response::denyAsNotFound();
        }

        return $comment->author_id === $user->id && Visibility::can($user, Permission::ItemComment, $comment->workItem->project)
            ? Response::allow()
            : Response::deny(__('problem.detail.comment_author_only'));
    }

    /** Deleting a comment: its author, or an admin of the project (org admins are admins in every project, A241). */
    public function delete(User $user, Comment $comment): Response
    {
        $role = Visibility::roleIn($user, $comment->workItem->project);
        if ($role === null) {
            return Response::denyAsNotFound();
        }

        return $comment->author_id === $user->id || $role === ProjectRole::Admin
            ? Response::allow()
            : Response::deny(__('problem.detail.comment_delete_admins_only'));
    }

    private static function sees(User $user, WorkItem $item): bool
    {
        return Visibility::roleIn($user, $item->project) !== null;
    }
}
