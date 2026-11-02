<?php

namespace App\Actions\Attachments;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ItemLock;
use finfo;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;
use Spatie\MediaLibrary\MediaCollections\Filesystem;

/**
 * Uploads a file into a project (spec 4.16): `inline` for a text (whoever may comment, A234; nobody owns it until a text
 * that names it is saved, A232; no event, A238) or `file` for the file list of an item (`item.edit`; the item owns it,
 * `work_item.updated` names it and the item gets a new `updated_at`). Its type is read from the content (A236), its name
 * cleaned. A file PHP dropped (above `upload_max_filesize`) or one above `ATTACHMENTS_MAX_MB` is a 413, never a missing
 * field. The file is written inside the transaction and removed again when it rolls back; the upload stays where it is
 * (`preservingOriginal`), so a retry after a deadlock finds it (K11).
 */
final class UploadAttachment
{
    use AsAction;

    /** The name of a file whose name is empty after cleaning. */
    public const FALLBACK_NAME = 'datei';

    /** The longest file name, in characters (`attachments.filename`). */
    public const NAME_MAX = 255;

    /**
     * @param  array<array-key, mixed>  $input  `project_id` (ULID, identifier or former identifier), `kind` (`inline` or `file`), with `file` the `work_item_id` (ULID or key)
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, array $input, ?UploadedFile $file): Attachment
    {
        $reference = $input['project_id'] ?? null;
        if (! is_string($reference)) {
            throw ValidationException::withMessages(['project_id' => __('field.required')]);
        }

        $project = Project::findByReference($reference) ?? throw Problem::notFound();
        // whoever sees the project may put a file into a text; nobody else learns that the project exists
        Authorize::check($actor, 'uploadInline', Attachment::class, $project);

        $kind = $input['kind'] ?? null;
        if (! in_array($kind, Attachment::KINDS, true)) {
            throw ValidationException::withMessages(['kind' => __('field.kind.attachment')]);
        }

        $item = $kind === 'file' ? self::item($actor, $project, $input['work_item_id'] ?? null) : null;
        $file = self::checked($file);

        $filename = self::cleanName($file->getClientOriginalName());
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file((string) $file->getRealPath()) ?: 'application/octet-stream';

        return DB::transaction(function () use ($actor, $project, $item, $kind, $file, $filename, $mime): Attachment {
            if ($item !== null) {
                $item = ItemLock::take($item);
                $project = $item->project;
            } else {
                // afresh and shared, like ItemLock: a project that went into deletion meanwhile is unknown
                $project = Project::query()->sharedLock()->whereNull('deleting_at')->find($project->id) ?? throw Problem::notFound();
            }

            if ($project->archived_at !== null) {
                throw Problem::conflict('project_archived', [], __('problem.detail.project_archived'));
            }
            if ($item?->archived_at !== null) {
                throw Problem::conflict('archived', [], __('problem.detail.item_archived', ['key' => $item->key]));
            }

            $attachment = Attachment::query()->create([
                'project_id' => $project->id,
                'attachable_type' => $item?->getMorphClass(),
                'attachable_id' => $item?->id,
                'kind' => $kind,
                'uploaded_by' => $actor->user->id,
                'filename' => $filename,
                'mime' => $mime,
                'size' => (int) $file->getSize(),
            ]);

            $media = $attachment->addMedia($file)
                ->preservingOriginal()
                // the name the client sent is the row's business (cleaned); medialibrary keeps the id
                ->usingName($attachment->id)
                ->usingFileName($attachment->id.'.'.self::extension($filename))
                ->toMediaCollection('file');
            // the file is there before the commit: a rollback takes it away with its rows
            DB::afterRollBack(fn () => app(Filesystem::class)->removeAllFiles($media));

            if ($item !== null) {
                $item->touch();
                EventRecorder::record(EventType::WorkItemUpdated, $actor, $item, $project, [
                    'attachments' => ['old' => null, 'new' => ['id' => $attachment->id, 'filename' => $filename]],
                ]);
            }

            return $attachment->load('media');
        }, 3);
    }

    /**
     * The item of the file list: one of this project the account may change. An item it does not see is unknown (404);
     * one of another project it sees is a field error.
     *
     * @throws ValidationException
     * @throws Problem
     */
    private static function item(Actor $actor, Project $project, mixed $reference): WorkItem
    {
        if (! is_string($reference)) {
            throw ValidationException::withMessages(['work_item_id' => __('field.required')]);
        }

        $item = WorkItem::findByReference($reference) ?? throw Problem::notFound();
        Authorize::check($actor, 'view', $item);

        if ($item->project_id !== $project->id) {
            throw ValidationException::withMessages(['work_item_id' => __('field.work_item_id.project')]);
        }

        Authorize::check($actor, 'update', $item);

        return $item;
    }

    /**
     * The file, if it arrived whole and within the limit. PHP drops a file above `upload_max_filesize` (or the form's
     * `MAX_FILE_SIZE`) and leaves only the error: that is the limit as well, a 413.
     *
     * @throws ValidationException
     * @throws Problem
     */
    private static function checked(?UploadedFile $file): UploadedFile
    {
        if ($file === null) {
            throw ValidationException::withMessages(['file' => __('field.file.required')]);
        }
        if (in_array($file->getError(), [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            throw Attachment::tooLarge();
        }
        if (! $file->isValid()) {
            throw ValidationException::withMessages(['file' => __('field.file.invalid')]);
        }
        if ($file->getSize() > Attachment::maxBytes()) {
            throw Attachment::tooLarge();
        }

        return $file;
    }

    /**
     * The name to show: its last path segment without control and format characters (no right-to-left override turns
     * `gpj.exe` around), at most NAME_MAX characters with the extension kept, FALLBACK_NAME when nothing is left.
     */
    private static function cleanName(string $name): string
    {
        $name = mb_scrub($name, 'UTF-8');
        $name = (string) preg_replace('/[\p{Cc}\p{Cf}]+/u', '', $name);
        $name = trim((string) preg_replace('~^.*[/\\\\]~u', '', $name));

        if (mb_strlen($name) > self::NAME_MAX) {
            $extension = pathinfo($name, PATHINFO_EXTENSION);
            $tail = $extension !== '' && mb_strlen($extension) < 16 ? '.'.$extension : '';
            $name = mb_substr($name, 0, self::NAME_MAX - mb_strlen($tail)).$tail;
        }

        return $name === '' ? self::FALLBACK_NAME : $name;
    }

    /**
     * The extension of the stored file: the name's, when it is short, plain and none medialibrary refuses (a `.php`
     * stays a `.php` for the reader, on the disk it is a `.bin`); the disk is private, nothing there runs.
     */
    private static function extension(string $filename): string
    {
        $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $refused = (array) config('media-library.disallowed_extensions');

        return preg_match('/^[a-z0-9]{1,10}$/', $extension) === 1 && ! in_array($extension, $refused, true) ? $extension : 'bin';
    }
}
