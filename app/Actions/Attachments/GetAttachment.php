<?php

namespace App\Actions\Attachments;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * An attachment's data (`GET /api/v1/attachments/{attachment}`) for whoever may read it (AttachmentPolicy::view);
 * everybody else gets the 404 of an unknown one.
 */
final class GetAttachment
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, Attachment $attachment): Attachment
    {
        Authorize::check($actor, 'view', $attachment);

        return $attachment->load('media');
    }
}
