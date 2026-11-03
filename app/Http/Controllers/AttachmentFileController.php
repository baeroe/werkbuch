<?php

namespace App\Http\Controllers;

use App\Actions\Attachments\ShowAttachment;
use App\Actions\Attachments\UploadAttachment;
use App\Models\Attachment;
use App\Support\Actor;
use finfo;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * The file of an attachment, for signed-in accounts and tokens that may read it (A235). Only the picture types of
 * Attachment::INLINE_TYPES, read from the content, are served as what they are and shown in the browser; every other
 * file (SVG and HTML too) is a download of `application/octet-stream`. Whatever it is, it is never sniffed, and opened
 * on its own it runs nothing and loads nothing. `?download=1` asks for the download of a picture. A preview is served as
 * the type its content has (medialibrary writes it in the format of the stored file name).
 */
final class AttachmentFileController extends Controller
{
    public function show(Request $request, Attachment $attachment): BinaryFileResponse
    {
        return self::serve($request, $attachment, false);
    }

    /** The preview of a picture; one that was never made is unknown (404). */
    public function preview(Request $request, Attachment $attachment): BinaryFileResponse
    {
        return self::serve($request, $attachment, true);
    }

    private static function serve(Request $request, Attachment $attachment, bool $preview): BinaryFileResponse
    {
        $media = ShowAttachment::run(Actor::fromRequest($request), $attachment, $preview);
        $path = $media->getPath($preview ? 'preview' : '');
        // a preview has the format of the stored name: the content's for pictures, files stored earlier may differ
        $type = $preview ? (new finfo(FILEINFO_MIME_TYPE))->file($path) : $attachment->mime;
        $inline = $attachment->isInlineImage() && ! $request->boolean('download');

        // a file response is public unless told otherwise; attachments are for their readers only
        return response()->file($path, [
            'Content-Type' => $attachment->isInlineImage() && in_array($type, Attachment::INLINE_TYPES, true) ? $type : 'application/octet-stream',
            'Content-Disposition' => HeaderUtils::makeDisposition($inline ? 'inline' : 'attachment', $attachment->filename, self::asciiName($attachment->filename)),
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
            'Cache-Control' => 'private, max-age=3600',
        ])->setPrivate();
    }

    /**
     * The name for clients that cannot read `filename*` (T6-M7): transliterated to ASCII, every character that is no
     * printable ASCII or that `filename=` cannot carry (`%`, `/`, `\`, `"`) an underscore, `datei` when nothing is left.
     */
    private static function asciiName(string $name): string
    {
        $ascii = trim((string) preg_replace('~[^\x20-\x7e]|[%/\\\\"]~', '_', Str::ascii($name)));

        return $ascii === '' ? UploadAttachment::FALLBACK_NAME : $ascii;
    }
}
