<?php

namespace App\Actions\Attachments;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * The file of an attachment (`/attachments/{attachment}`, its preview under `…/preview`) for whoever may read it
 * (AttachmentPolicy::view); everybody else gets the 404 of an unknown one. A preview that was never made is unknown as
 * well. How it is served (type, inline or download) the controller decides from `mime`.
 */
final class ShowAttachment
{
    use AsAction;

    /**
     * @throws Problem
     */
    public function handle(Actor $actor, Attachment $attachment, bool $preview = false): Media
    {
        Authorize::check($actor, 'view', $attachment);

        $media = $attachment->getFirstMedia('file');
        if ($media === null || ($preview && ! $media->hasGeneratedConversion('preview'))) {
            throw Problem::notFound();
        }

        return $media;
    }
}
