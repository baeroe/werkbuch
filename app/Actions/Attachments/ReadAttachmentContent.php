<?php

namespace App\Actions\Attachments;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Support\Actor;
use App\Support\AttachmentContent;
use finfo;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Number;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * What an agent sees of an attachment (A771, MCP `attachments:content`): a picture a model reads (MODEL_IMAGE_TYPES) as
 * its bytes (the preview when there is one, else the original, at most IMAGE_MAX), a text file as text (the first
 * TEXT_MAX bytes), anything else (also an AVIF) only its name, type and size. For whoever may read it
 * (AttachmentPolicy::view): everybody else gets the 404 of an unknown one, as does an attachment whose file is gone.
 * Reads only.
 */
final class ReadAttachmentContent
{
    use AsAction;

    /** The pictures a model reads as an image; any other picture (AVIF) is a file like any other. */
    public const MODEL_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

    /**
     * The largest picture it gives, in bytes: a model takes an image of at most 5 MiB base64-encoded, that is 3.75 MiB
     * (3 932 160 bytes) of the picture itself.
     */
    public const IMAGE_MAX = 3_932_160;

    /** The most bytes of a text it gives. */
    public const TEXT_MAX = 200 * 1024;

    /** Types read as text besides `text/*`. */
    public const TEXT_TYPES = ['application/json', 'application/xml', 'application/x-yaml', 'application/yaml'];

    /**
     * @throws Problem 404 unknown, hidden or its file gone; 413 `payload_too_large` for a picture over IMAGE_MAX
     */
    public function handle(Actor $actor, Attachment $attachment): AttachmentContent
    {
        Authorize::check($actor, 'view', $attachment);

        $media = $attachment->getFirstMedia('file') ?? throw Problem::notFound();
        $disk = Storage::disk($media->disk);

        if (in_array($attachment->mime, self::MODEL_IMAGE_TYPES, true)) {
            $preview = $media->hasGeneratedConversion('preview');
            $path = $media->getPathRelativeToRoot($preview ? 'preview' : '');
            $disk->exists($path) || throw Problem::notFound();
            if ($disk->size($path) > self::IMAGE_MAX) {
                throw Problem::tooLarge(__('problem.detail.attachment_content_too_large', ['max' => Number::format(self::IMAGE_MAX / 1048576, maxPrecision: 2, locale: App::getLocale())]));
            }
            $bytes = (string) $disk->get($path);
            $found = (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes);

            return new AttachmentContent($attachment, AttachmentContent::IMAGE, $bytes, in_array($found, self::MODEL_IMAGE_TYPES, true) ? $found : $attachment->mime, $preview);
        }

        if (str_starts_with($attachment->mime, 'text/') || in_array($attachment->mime, self::TEXT_TYPES, true)) {
            $path = $media->getPathRelativeToRoot();
            $disk->exists($path) || throw Problem::notFound();
            $stream = $disk->readStream($path) ?? throw Problem::notFound();
            $bytes = (string) stream_get_contents($stream, self::TEXT_MAX + 1);
            fclose($stream);
            $cut = strlen($bytes) > self::TEXT_MAX;

            return new AttachmentContent($attachment, AttachmentContent::TEXT, mb_scrub(mb_strcut($bytes, 0, self::TEXT_MAX)), $attachment->mime, cut: $cut);
        }

        return new AttachmentContent($attachment, AttachmentContent::OTHER, '', $attachment->mime);
    }
}
