<?php

namespace App\Http\Resources;

use App\Models\Attachment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An attachment as `Attachment` of resources/js/types.ts: its owner (`{type, id}`, or null while nobody owns it), the
 * type read from the content, whether a browser may show it as a picture (`inline`), the address of the file and of its
 * preview (null until one was made), both relative. It asks nothing: the actions load `media` beforehand.
 *
 * @mixin Attachment
 */
final class AttachmentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Attachment $attachment */
        $attachment = $this->resource;
        $media = $attachment->getFirstMedia('file');

        return [
            'id' => $attachment->id,
            'project_id' => $attachment->project_id,
            'owner' => $attachment->attachable_id === null ? null : ['type' => $attachment->attachable_type, 'id' => $attachment->attachable_id],
            'kind' => $attachment->kind,
            'filename' => $attachment->filename,
            'mime' => $attachment->mime,
            'size' => $attachment->size,
            'inline' => $attachment->isInlineImage(),
            'url' => route('attachments.show', $attachment->id, false),
            'preview_url' => $media?->hasGeneratedConversion('preview') === true ? route('attachments.preview', $attachment->id, false) : null,
            'uploaded_by' => $attachment->uploaded_by,
            'created_at' => $attachment->created_at?->toJSON(),
        ];
    }
}
