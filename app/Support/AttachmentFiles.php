<?php

namespace App\Support;

use App\Models\Attachment;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Spatie\MediaLibrary\MediaCollections\Filesystem;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * The one way to remove the files of attachments (K12): their `media` rows go at once, quietly, inside the caller's
 * transaction (a rollback brings them back), the files with their previews only after the commit. The `attachments`
 * rows are the caller's, and only through the query builder: `$attachment->delete()` would let medialibrary remove the
 * files at once, in the middle of the transaction.
 */
final class AttachmentFiles
{
    /**
     * @param  Collection<int, Attachment>  $attachments
     */
    public static function removeAfterCommit(Collection $attachments): void
    {
        $media = Media::query()
            ->where('model_type', (new Attachment)->getMorphClass())
            ->whereIn('model_id', $attachments->map(fn (Attachment $attachment) => $attachment->id))
            ->get();

        $media->each(fn (Media $file) => $file->deleteQuietly());
        DB::afterCommit(fn () => $media->each(fn (Media $file) => app(Filesystem::class)->removeAllFiles($file)));
    }
}
