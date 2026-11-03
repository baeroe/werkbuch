<?php

namespace App\Http\Controllers\Api;

use App\Actions\Attachments\DeleteAttachment;
use App\Actions\Attachments\GetAttachment;
use App\Actions\Attachments\UploadAttachment;
use App\Http\Controllers\Controller;
use App\Http\Resources\AttachmentResource;
use App\Models\Attachment;
use App\Support\Actor;
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
    /** 201: the attachment was just created. */
    public function store(Request $request): AttachmentResource
    {
        $file = $request->file('file');

        return new AttachmentResource(UploadAttachment::run(
            Actor::fromRequest($request),
            $request->except('file'),
            $file instanceof UploadedFile ? $file : null,
        ));
    }

    public function show(Request $request, Attachment $attachment): AttachmentResource
    {
        return new AttachmentResource(GetAttachment::run(Actor::fromRequest($request), $attachment));
    }

    /** 204; who may delete what, DeleteAttachment decides (A238). */
    public function destroy(Request $request, Attachment $attachment): Response
    {
        DeleteAttachment::run(Actor::fromRequest($request), $attachment);

        return response()->noContent();
    }
}
