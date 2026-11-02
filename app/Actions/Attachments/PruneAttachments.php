<?php

namespace App\Actions\Attachments;

use App\Domain\Properties\FieldType;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Project;
use App\Models\Property;
use App\Models\WorkItem;
use App\Models\WorkItemValue;
use App\RichText\Document;
use App\Support\Actor;
use App\Support\AttachmentFiles;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use InvalidArgumentException;
use Lorisleiva\Actions\Concerns\AsAction;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * The work of app:prune-attachments (spec 4.16, A239): pictures and files of texts (`inline` with an owner) older than
 * the minimum age that no current text of their project names any more: neither the description nor a rich text value
 * of an item, nor the text of a comment. A text that names another text's picture (copied from a comment into the
 * description) keeps it too. Texts in the history do not count: an older version of a description may show a picture
 * this removed (the operator's choice, the docs say so). Files of the file list (`file`) go only by hand, uploads
 * nobody owns with the hourly job (PruneUnownedAttachments). No event (A239).
 *
 * Project by project, each in a transaction of its own: the candidates `for update` first, then the texts. A text saved
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

    /** The texts read at a time while collecting the attachments they name. */
    private const READ_BLOCK = 500;

    /**
     * @return list<array{id: string, project: string, filename: string, size: int}> what went (would go in a dry run),
     *                                                                               by project, then id
     *
     * @throws InvalidArgumentException for a minimum age below one day
     */
    public function handle(Actor $actor, int $minAgeDays, bool $dryRun): array
    {
        $before = self::cutoff($minAgeDays);
        $pruned = [];

        foreach (self::candidates($before)->distinct()->orderBy('project_id')->pluck('project_id') as $projectId) {
            $prune = fn (): array => self::pruneIn((string) $projectId, $before, $dryRun);
            array_push($pruned, ...($dryRun ? $prune() : DB::transaction($prune, 3)));
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
            $files = collect($disk->allFiles($folder));
            if ($known->has(basename($folder)) || $files->contains(fn (string $file) => $disk->lastModified($file) >= $before)) {
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
        $named = self::named($projectId);
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
     * The attachments the current texts of the project name, as a set: item descriptions, rich text values, comments.
     *
     * @return array<string, true>
     */
    private static function named(string $projectId): array
    {
        $named = [];
        $collect = function (?array $json) use (&$named): void {
            foreach ($json === null ? [] : Document::fromJson($json)->attachmentIds() as $id) {
                $named[$id] = true;
            }
        };
        $items = WorkItem::query()->where('project_id', $projectId)->select('id');

        WorkItem::query()->where('project_id', $projectId)->whereNotNull('description')->select(['id', 'description'])
            ->lazyById(self::READ_BLOCK)->each(fn (WorkItem $item) => $collect($item->description));
        WorkItemValue::query()->whereIn('work_item_id', $items)
            ->whereIn('property_id', Property::query()->where('field_type', FieldType::RichText)->select('id'))
            ->select(['id', 'value_json'])->lazyById(self::READ_BLOCK)->each(fn (WorkItemValue $value) => $collect($value->value_json));
        Comment::query()->whereIn('work_item_id', $items)->select(['id', 'body'])
            ->lazyById(self::READ_BLOCK)->each(fn (Comment $comment) => $collect($comment->body));

        return $named;
    }

    /**
     * Pictures and files of texts, older than `$before`.
     *
     * @return Builder<Attachment>
     */
    private static function candidates(CarbonInterface $before): Builder
    {
        return Attachment::query()->where('kind', 'inline')->whereNotNull('attachable_id')->where('created_at', '<', $before);
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
