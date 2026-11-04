<?php

namespace App\Actions\Attachments;

use App\Models\Attachment;
use App\Models\Project;
use App\Support\Actor;
use App\Support\AttachmentFiles;
use App\Support\AttachmentTexts;
use App\Support\UnreadableText;
use Carbon\CarbonInterface;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use InvalidArgumentException;
use Lorisleiva\Actions\Concerns\AsAction;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * The work of app:prune-attachments (spec 4.16, A239): pictures and files of texts (`inline` with an owner of
 * AttachmentTexts::OWNERS: an item, a comment, a wiki page) older than the minimum age that no current text of their
 * project names any more: neither the description nor a rich text value of an item, nor the text of a comment, nor the
 * text of a page or one of its kept versions (A314: they are shown and restored). A text that names another text's
 * picture (copied from a comment into the description or a page) keeps it too. Texts in the history of items do not
 * count: an older version of a description may show a picture this removed (the operator's choice, the docs say so). Files of the file list (`file`) go only by hand, uploads
 * nobody owns with the hourly job (PruneUnownedAttachments). No event (A239).
 *
 * Project by project, each in a transaction of its own: the candidates `for update` first, then the texts (the lock
 * covers the scanned range of the project's attachments while its texts are read: uploads and links in the project
 * wait that long, T13-M6). A project with a text that cannot be read is skipped and reported (UnreadableText). A text saved
 * meanwhile that names a candidate either committed before (the texts are read after the locks: it keeps the picture)
 * or waits in AttachmentLinks for the lock and finds the picture gone (422 as for any unknown attachment). The files
 * go after the commit (K12). A dry run locks and removes nothing.
 *
 * `folders()` sweeps the media disk for folders of files whose media row is gone: a preview that a conversion job wrote
 * after its attachment was deleted (T7-M4).
 */
final class PruneAttachments
{
    use AsAction;

    /**
     * @param  (Closure(string, UnreadableText): void)|null  $skipped  told of each project skipped for a text that cannot be
     *                                                                 read (its identifier); the error is reported too
     * @return list<array{id: string, project: string, filename: string, size: int}> what went (would go in a dry run),
     *                                                                               by project, then id
     *
     * @throws InvalidArgumentException for a minimum age below one day
     */
    public function handle(Actor $actor, int $minAgeDays, bool $dryRun, ?Closure $skipped = null): array
    {
        $before = self::cutoff($minAgeDays);
        $pruned = [];

        foreach (self::candidates($before)->distinct()->orderBy('project_id')->pluck('project_id') as $projectId) {
            $prune = fn (): array => self::pruneIn((string) $projectId, $before, $dryRun);
            try {
                array_push($pruned, ...($dryRun ? $prune() : DB::transaction($prune, 3)));
            } catch (UnreadableText $error) {
                // which texts name what is unknown in this project: nothing of it goes, the others still get their turn
                report($error);
                if ($skipped !== null) {
                    $skipped((string) Project::query()->whereKey($projectId)->value('identifier'), $error);
                }
            }
        }

        return $pruned;
    }

    /**
     * Removes the folders on the media disk whose name is the key of a media row that is gone and whose files are all
     * older than the minimum age (a folder being written right now has a young file).
     *
     * @return list<array{folder: string, size: int}> the folders that went (would go in a dry run) and their bytes
     *
     * @throws InvalidArgumentException for a minimum age below one day
     */
    public function folders(int $minAgeDays, bool $dryRun): array
    {
        $before = self::cutoff($minAgeDays)->getTimestamp();
        $disk = Storage::disk((string) config('media-library.disk_name'));
        $folders = collect($disk->directories(trim((string) config('media-library.prefix'), '/')))
            ->filter(fn (string $folder) => preg_match('/^[1-9][0-9]*$/', basename($folder)) === 1)
            ->values();
        $known = Media::query()->whereIn('id', $folders->map(fn (string $folder) => (int) basename($folder)))->pluck('id')
            ->mapWithKeys(fn (int|string $id) => [(string) $id => true]);

        $orphans = [];
        foreach ($folders as $folder) {
            // only the folders without a media row are listed: the others may hold many files (T13-M5)
            if ($known->has(basename($folder))) {
                continue;
            }
            $files = collect($disk->allFiles($folder));
            if ($files->contains(fn (string $file) => $disk->lastModified($file) >= $before)) {
                continue;
            }

            $orphans[] = ['folder' => $folder, 'size' => (int) $files->sum(fn (string $file) => $disk->size($file))];
            if (! $dryRun) {
                $disk->deleteDirectory($folder);
            }
        }

        return $orphans;
    }

    /**
     * @return list<array{id: string, project: string, filename: string, size: int}>
     */
    private static function pruneIn(string $projectId, CarbonInterface $before, bool $dryRun): array
    {
        $rows = self::candidates($before)->where('project_id', $projectId)->orderBy('id')
            ->when(! $dryRun, fn (Builder $query) => $query->lockForUpdate())->get();
        $named = AttachmentTexts::namers($projectId);
        $unnamed = $rows->reject(fn (Attachment $attachment) => isset($named[$attachment->id]))->values();

        if (! $dryRun && $unnamed->isNotEmpty()) {
            AttachmentFiles::removeAfterCommit($unnamed);
            Attachment::query()->whereKey($unnamed->modelKeys())->delete();
        }

        $project = (string) Project::query()->whereKey($projectId)->value('identifier');

        return array_values($unnamed->map(fn (Attachment $attachment) => [
            'id' => $attachment->id, 'project' => $project, 'filename' => $attachment->filename, 'size' => $attachment->size,
        ])->all());
    }

    /**
     * Pictures and files of the texts AttachmentTexts reads (OWNERS), older than `$before`.
     *
     * @return Builder<Attachment>
     */
    private static function candidates(CarbonInterface $before): Builder
    {
        return Attachment::query()->where('kind', 'inline')->whereIn('attachable_type', AttachmentTexts::OWNERS)
            ->whereNotNull('attachable_id')->where('created_at', '<', $before);
    }

    /**
     * @throws InvalidArgumentException
     */
    private static function cutoff(int $minAgeDays): CarbonInterface
    {
        if ($minAgeDays < 1) {
            throw new InvalidArgumentException("The minimum age is at least one day, not {$minAgeDays}.");
        }

        return now()->subDays($minAgeDays);
    }
}
