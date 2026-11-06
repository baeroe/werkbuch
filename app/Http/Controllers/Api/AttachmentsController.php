<?php

namespace App\Http\Controllers\Api;

use App\Actions\Attachments\DeleteAttachment;
use App\Actions\Attachments\GetAttachment;
use App\Actions\Attachments\UploadAttachment;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\AttachmentResource;
use App\Models\Attachment;
use App\OpenApi\ContentSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;

/**
 * Uploading attachments (multipart, the file under `file`), reading their data and deleting them. `{attachment}` is
 * bound by ULID (routes/api.php); whether the account may read or delete it, the action decides. The file itself is
 * served by the web route `/attachments/{attachment}` (AttachmentFileController).
 */
final class AttachmentsController extends Controller
{
    /**
     * Upload a file.
     *
     * As `multipart/form-data` with the file under `file`; 201 `{data: Attachment}`. The data say where the file is
     * (`url`, outside `/api/v1`); a file larger than the limit is 413 and the answer names it.
     */
    #[Body(ContentSchemas::class, 'upload', 'multipart/form-data')]
    public function store(Request $request): JsonResponse
    {
        $file = $request->file('file');

        return (new AttachmentResource(UploadAttachment::run(
            Actor::fromRequest($request),
            $request->except('file'),
            $file instanceof UploadedFile ? $file : null,
        )))->response()->setStatusCode(201);
    }

    /**
     * Read the data of an attachment.
     *
     * Whoever sees what names it. The file itself is `GET /attachments/{id}` (outside `/api/v1`; `?download=1` downloads it
     * instead of showing a picture, `…/preview` is the smaller picture); a bearer token with `read` is enough for it.
     */
    public function show(Request $request, Attachment $attachment): AttachmentResource
    {
        return new AttachmentResource(GetAttachment::run(Actor::fromRequest($request), $attachment));
    }

    /**
     * Delete an attachment.
     *
     * Only an upload nobody names yet (its uploader) or a file of the list of an item the account may change; a picture or file
     * inside a text goes with the text (409 `attachment_inline`). 204.
     */
    public function destroy(Request $request, Attachment $attachment): Response
    {
        DeleteAttachment::run(Actor::fromRequest($request), $attachment);

        return response()->noContent();
    }
}
