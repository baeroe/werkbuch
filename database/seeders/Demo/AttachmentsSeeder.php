<?php

namespace Database\Seeders\Demo;

use App\Actions\Attachments\UploadAttachment;
use App\Models\Attachment;
use Closure;
use finfo;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Spatie\MediaLibrary\MediaCollections\Filesystem;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * The three files of the file lists of the demo items (the `attachments` of src/api/seed/activity.ts; the files are
 * the data URLs of src/api/seed/files.ts, decoded into `files/`). The seed names no uploader: the person who created
 * the item and whose text says the file is attached uploads it, when the item was created. Stored like an upload
 * (UploadAttachment): the row of kind `file` owned by the item, `mime` read from the content, the file in the media
 * collection `file` under the row's ID (an image gets its preview on the queue `media`); the source stays where it is.
 * Without events (A86).
 *
 * Safe to run again: an item gets a file only while it has none of that name, so a file somebody deleted comes back
 * and a second run adds nothing.
 */
class AttachmentsSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Item and file name (in `files/`).
     *
     * @var list<array{0: string, 1: string}>
     */
    private const FILES = [
        ['WEB-42', 'hero-entwurf.png'],
        ['WEB-45', 'leistungsseiten-gliederung.pdf'],
        ['OPS-12', 'postfix-main.cf.txt'],
    ];

    public function run(): void
    {
        foreach (self::FILES as [$key, $filename]) {
            $item = ItemsSeeder::find($key);
            if ($item === null || Attachment::query()->whereMorphedTo('attachable', $item)->where('filename', $filename)->exists()) {
                continue;
            }

            $path = __DIR__."/files/{$filename}";
            // one transaction each: the row and its file belong together
            DB::transaction(function () use ($item, $filename, $path): void {
                $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path) ?: 'application/octet-stream';
                $attachment = new Attachment;
                $attachment->forceFill([
                    'project_id' => $item->project_id,
                    'attachable_type' => $item->getMorphClass(),
                    'attachable_id' => $item->id,
                    'kind' => 'file',
                    'uploaded_by' => $item->created_by,
                    'filename' => $filename,
                    'mime' => $mime,
                    'size' => (int) filesize($path),
                    'created_at' => $item->created_at,
                    'updated_at' => $item->created_at,
                ])->save();

                $media = self::withModelEvents(fn () => $attachment->addMedia($path)
                    ->preservingOriginal()
                    ->usingName($attachment->id)
                    ->usingFileName($attachment->id.'.'.UploadAttachment::storedExtension($filename, $mime))
                    ->toMediaCollection('file'));
                // like an upload: a rollback takes the copied file away with its rows
                DB::afterRollBack(fn () => app(Filesystem::class)->removeAllFiles($media));
            });
        }
    }

    /**
     * Runs `$write` with the model events the demo seeders switch off (WithoutModelEvents): medialibrary gives a media
     * row its `uuid` and its place in the collection in them, without them the row cannot be written.
     *
     * @param  Closure(): Media  $write
     */
    private static function withModelEvents(Closure $write): Media
    {
        // WithoutModelEvents puts a null dispatcher in place, never none
        $silenced = Model::getEventDispatcher() ?? app(Dispatcher::class);
        Model::setEventDispatcher(app(Dispatcher::class));

        try {
            return $write();
        } finally {
            Model::setEventDispatcher($silenced);
        }
    }
}
