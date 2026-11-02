<?php

namespace App\Policies;

use App\Access\Permission;
use App\Access\Visibility;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Auth\Access\Response;

/**
 * Who may upload and read attachments (spec 4.16, A234). What the account must not read is always a 404, never a 403:
 * an attachment never tells that it exists.
 */
final class AttachmentPolicy
{
    /**
     * Uploading a picture or file into a text: whoever may comment in the project (`item.comment`, viewers and outsiders
     * of a public project as well, A234). Every role in a project holds that right, so only not seeing the project
     * refuses, and that as a 404.
     */
    public function uploadInline(User $user, Project $project): Response
    {
        return Visibility::can($user, Permission::ItemComment, $project) ? Response::allow() : Response::denyAsNotFound();
    }

    /**
     * Reading an attachment: one of an item or of a comment whoever sees the item; one nobody owns yet (`attachable_id`
     * empty) only the person who uploaded it. An owner that is named but gone hides it from everybody, and so does a
     * project being deleted.
     */
    public function view(User $user, Attachment $attachment): Response
    {
        if ($attachment->project->deleting_at !== null) {
            return Response::denyAsNotFound();
        }

        $visible = $attachment->attachable_id === null
            ? $attachment->uploaded_by === $user->id
            : self::ownerVisible($user, $attachment);

        return $visible ? Response::allow() : Response::denyAsNotFound();
    }

    /** Whether the owner exists and the account may see it: an item, or the item of a comment. */
    private static function ownerVisible(User $user, Attachment $attachment): bool
    {
        $item = match ($attachment->attachable_type) {
            (new WorkItem)->getMorphClass() => WorkItem::query()->with('project')->find($attachment->attachable_id),
            (new Comment)->getMorphClass() => Comment::query()->with('workItem.project')->find($attachment->attachable_id)?->workItem,
            default => null,
        };

        return $item !== null && Visibility::roleIn($user, $item->project) !== null;
    }
}
