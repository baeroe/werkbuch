<?php

namespace App\Models;

use App\Exceptions\Problem;
use Database\Factories\AttachmentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Support\Carbon;
use Spatie\Image\Enums\Fit;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * A file of a project (spec 4.16): a picture or file in a text (`inline`) or one of the file list of an item (`file`).
 * The file is the media collection `file`, of any type; `mime` was read from its content (A236), and only the picture
 * types of INLINE_TYPES are ever served as what they are. Who reads it follows its owner (AttachmentPolicy): an upload
 * nobody owns yet belongs to the person who uploaded it. A PNG, JPEG or WebP gets a preview of at most 1600 × 1600 pixels
 * (`preview`, A237), made on the queue `media` after the commit, in the format of the stored file.
 *
 * @property string $id
 * @property string $project_id
 * @property string|null $attachable_type
 * @property string|null $attachable_id
 * @property string $kind
 * @property string $uploaded_by
 * @property string $filename
 * @property string $mime
 * @property int $size
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Project $project
 * @property-read User $uploader
 * @property-read Model|null $attachable
 */
#[Fillable(['project_id', 'attachable_type', 'attachable_id', 'kind', 'uploaded_by', 'filename', 'mime', 'size'])]
final class Attachment extends Model implements HasMedia
{
    /** @use HasFactory<AttachmentFactory> */
    use HasFactory, HasUlids, InteractsWithMedia;

    /** The kinds: a picture or file in a text, or a file of the file list of an item. */
    public const KINDS = ['inline', 'file'];

    /** The picture types a browser shows without running anything; every other file is a download. */
    public const INLINE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

    /** The picture types that get a preview (A237): GD loses the animation of a GIF, and AVIF is slow to encode. */
    public const PREVIEW_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

    /** The longest side of a preview, in pixels. */
    public const PREVIEW_SIZE = 1600;

    /** The limit of a file in MB without `ATTACHMENTS_MAX_MB` (both config/werkbuch.php and config/media-library.php). */
    public const DEFAULT_MAX_MB = 25;

    /** The largest file in bytes (`ATTACHMENTS_MAX_MB`). */
    public static function maxBytes(): int
    {
        return self::maxMegabytes() * 1024 * 1024;
    }

    public static function maxMegabytes(): int
    {
        return (int) config('werkbuch.attachments_max_mb');
    }

    /** The refusal of a file (or a request) above the limit: 413 `payload_too_large` with the limit in its sentence. */
    public static function tooLarge(): Problem
    {
        return Problem::tooLarge(__('problem.detail.payload_too_large', ['max' => self::maxMegabytes()]));
    }

    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('file')->singleFile();
    }

    /**
     * The preview of a picture of PREVIEW_TYPES, never enlarged, on the queue of `media-library.queue_name`. medialibrary
     * asks a fresh model, never the stored one: the type is the media's, read from the content by `finfo` like `mime`.
     * The preview keeps the format of the stored file (medialibrary would make a JPEG of every preview, a transparent
     * PNG would turn black, K14); which format that is, the file tells (AttachmentFileController).
     */
    public function registerMediaConversions(?Media $media = null): void
    {
        if (! in_array($media?->mime_type, self::PREVIEW_TYPES, true)) {
            return;
        }

        $this->addMediaConversion('preview')
            ->performOnCollections('file')
            ->keepOriginalImageFormat()
            ->nonOptimized()
            ->queued()
            ->fit(Fit::Max, self::PREVIEW_SIZE, self::PREVIEW_SIZE);
    }

    /** Whether the content is a picture a browser may show as such. */
    public function isInlineImage(): bool
    {
        return in_array($this->mime, self::INLINE_TYPES, true);
    }

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    /**
     * @return MorphTo<Model, $this>
     */
    public function attachable(): MorphTo
    {
        return $this->morphTo();
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['size' => 'integer'];
    }
}
