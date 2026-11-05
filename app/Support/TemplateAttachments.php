<?php

namespace App\Support;

use App\Actions\Attachments\UploadAttachment;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\Template;
use App\Models\User;
use App\RichText\Document;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Spatie\MediaLibrary\MediaCollections\FileAdder;
use Spatie\MediaLibrary\MediaCollections\Filesystem;

/**
 * Copies the pictures and files of a template into the texts of the item made from it (spec 4.12 „Anhänge werden beim
 * Anwenden kopiert“, A337), before any lock of the caller: copying files never runs under the project lock. Each picture
 * or file the template owns becomes a new attachment nobody owns yet, uploaded by the writer (the default bot for a
 * run), with the same kind, name, type and size and a copy of the file; the texts name the copies, and AttachmentLinks
 * then gives them to the item. Anything the template does not own stays as it is (another text's picture is shared,
 * A233). A text that names the same picture twice, or two texts that name it, get one copy.
 *
 * Each copy is made in a small transaction of its own under the project (shared, afresh): a project that went into
 * deletion meanwhile gets no copy (its texts stay as they were; the caller's lock refuses the project). A source whose
 * row or file vanished (the template was deleted meanwhile, K13) falls out of the text, like a dead node of the rules
 * of saving. A copy whose item is then refused keeps no owner and goes with the hourly prune after a day (A239).
 */
final class TemplateAttachments
{
    /**
     * @param  array<string, ?Document>  $texts  the key that sent a text → the text
     * @return array<string, ?Document> the same keys, the texts naming the copies
     */
    public static function copy(Template $template, array $texts, User $writer): array
    {
        $ids = [];
        foreach ($texts as $text) {
            foreach ($text?->attachmentIds() ?? [] as $id) {
                $ids[$id] = true;
            }
        }
        if ($ids === []) {
            return $texts;
        }

        $rows = Attachment::query()->whereKey(array_keys($ids))->with('media')->get()->keyBy('id');
        /** @var array<string, ?string> $copies the id named → the id of its copy, null to drop the node */
        $copies = [];
        foreach (array_keys($ids) as $id) {
            $row = $rows->get($id);
            if ($row === null) {
                $copies[$id] = null;
            } elseif ($row->attachable_type === $template->getMorphClass() && $row->attachable_id === $template->id) {
                $copy = self::copyOne($row, $template->project_id, $writer);
                if ($copy !== false) {
                    $copies[$id] = $copy;
                }
            }
        }
        if ($copies === []) {
            return $texts;
        }

        return array_map(fn (?Document $text) => $text?->withNodes(function (array $node) use ($copies): ?array {
            /** @var array<string, mixed> $attrs */
            $attrs = $node['attrs'] ?? [];
            $id = $attrs['attachmentId'] ?? null;
            if (! is_string($id) || ! array_key_exists($id, $copies)) {
                return $node;
            }

            return $copies[$id] === null ? null : ['attrs' => ['attachmentId' => $copies[$id]] + $attrs] + $node;
        }), $texts);
    }

    /**
     * The id of the copy; null when the source has no file (any more): the node goes; false when the project went into
     * deletion: the text stays as it is.
     */
    private static function copyOne(Attachment $source, string $projectId, User $writer): string|false|null
    {
        $media = $source->getFirstMedia('file');
        if ($media === null || ! Storage::disk($media->disk)->exists($media->getPathRelativeToRoot())) {
            return null;
        }

        return DB::transaction(function () use ($source, $media, $projectId, $writer): string|false {
            // afresh and shared, like an upload: a project that went into deletion meanwhile is no place for a copy
            $project = Project::query()->sharedLock()->whereNull('deleting_at')->find($projectId);
            if ($project === null) {
                return false;
            }

            $copy = Attachment::query()->create([
                'project_id' => $project->id,
                'attachable_type' => null,
                'attachable_id' => null,
                'kind' => $source->kind,
                'uploaded_by' => $writer->id,
                'filename' => $source->filename,
                'mime' => $source->mime,
                'size' => $source->size,
            ]);
            $copied = $media->copy($copy, 'file', '', $copy->id.'.'.UploadAttachment::storedExtension($source->filename, $source->mime),
                fn (FileAdder $adder) => $adder->usingName($copy->id));
            // the file is there before the commit: a rollback takes it away with its rows
            DB::afterRollBack(fn () => app(Filesystem::class)->removeAllFiles($copied));

            return $copy->id;
        }, 3);
    }
}
