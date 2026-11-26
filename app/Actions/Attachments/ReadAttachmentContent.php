<?php

namespace App\Actions\Attachments;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Support\Actor;
use App\Support\AttachmentContent;
use finfo;
use Illuminate\Support\Facades\Storage;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * What an agent sees of an attachment (A772, MCP `attachments:content`): a picture as its bytes (the preview when there
 * is one, else the original, at most IMAGE_MAX), a text file as text (the first TEXT_MAX bytes), anything else only its
 * name, type and size. For whoever may read it (AttachmentPolicy::view): everybody else gets the 404 of an unknown one,
 * as does an attachment without its file. Reads only.
 */
final class ReadAttachmentContent
{
    use AsAction;

    /** The largest picture it gives, in bytes (a model reads at most a few MB of an image). */
    public const IMAGE_MAX = 5 * 1024 * 1024;

    /** The most bytes of a text it gives. */
    public const TEXT_MAX = 200 * 1024;

    /** Types read as text besides `text/*`. */
    public const TEXT_TYPES = ['application/json', 'application/xml', 'application/x-yaml', 'application/yaml'];

    /**
     * @throws Problem 404 unknown, hidden or without its file; 413 `payload_too_large` for a picture over IMAGE_MAX
     */
    public function handle(Actor $actor, Attachment $attachment): AttachmentContent
    {
        Authorize::check($actor, 'view', $attachment);

        $media = $attachment->getFirstMedia('file') ?? throw Problem::notFound();
        $disk = Storage::disk($media->disk);

        if (in_array($attachment->mime, Attachment::INLINE_TYPES, true)) {
            $preview = $media->hasGeneratedConversion('preview');
            $path = $media->getPathRelativeToRoot($preview ? 'preview' : '');
            if ($disk->size($path) > self::IMAGE_MAX) {
                throw Problem::tooLarge(__('problem.detail.attachment_content_too_large', ['max' => self::IMAGE_MAX >> 20]));
            }
            $bytes = (string) $disk->get($path);
            $found = (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes);

            return new AttachmentContent($attachment, AttachmentContent::IMAGE, $bytes, in_array($found, Attachment::INLINE_TYPES, true) ? $found : $attachment->mime, $preview);
        }

        if (str_starts_with($attachment->mime, 'text/') || in_array($attachment->mime, self::TEXT_TYPES, true)) {
            $stream = $disk->readStream($media->getPathRelativeToRoot()) ?? throw Problem::notFound();
            $bytes = (string) stream_get_contents($stream, self::TEXT_MAX + 1);
            fclose($stream);
            $cut = strlen($bytes) > self::TEXT_MAX;

            return new AttachmentContent($attachment, AttachmentContent::TEXT, mb_scrub(mb_strcut($bytes, 0, self::TEXT_MAX)), $attachment->mime, cut: $cut);
        }

        return new AttachmentContent($attachment, AttachmentContent::OTHER, '', $attachment->mime);
    }
}
