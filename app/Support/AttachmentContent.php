<?php

namespace App\Support;

use App\Models\Attachment;

/**
 * The content of an attachment as ReadAttachmentContent reads it (A772): a picture (its bytes and type, `preview` when
 * it is the preview), a text (`cut` when it goes on) or nothing readable (`other`).
 */
final readonly class AttachmentContent
{
    public const IMAGE = 'image';

    public const TEXT = 'text';

    public const OTHER = 'other';

    public function __construct(
        public Attachment $attachment,
        public string $kind,
        public string $data,
        public string $mime,
        public bool $preview = false,
        public bool $cut = false,
    ) {}

    /**
     * What the agent reads before the content: the attachment, what of it follows.
     *
     * @return array{id: string, filename: string, mime: string, size: int, shown: string}
     */
    public function facts(): array
    {
        return [
            'id' => $this->attachment->id, 'filename' => $this->attachment->filename, 'mime' => $this->attachment->mime, 'size' => $this->attachment->size,
            'shown' => match ($this->kind) {
                self::IMAGE => $this->preview ? 'the preview as an image' : 'the original as an image',
                self::TEXT => $this->cut ? 'the first '.strlen($this->data).' bytes as text' : 'the whole file as text',
                default => 'nothing: neither a picture nor text; GET the url of attachments:get with the same token to download it',
            },
        ];
    }
}
