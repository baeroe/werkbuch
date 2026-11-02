<?php

namespace App\Console\Commands;

use App\Actions\Attachments\PruneAttachments;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Removes pictures and files of texts that no current text names any more, older than `--min-age` days (spec 4.16,
 * A239), and folders of files on the media disk whose media row is gone. `--dry-run` only lists them. Pictures that
 * only an older version of a text in the history shows go too: that is the operator's choice.
 */
class PruneAttachmentsCommand extends Command
{
    protected $signature = 'app:prune-attachments
        {--dry-run : List what would go, remove nothing}
        {--min-age=30 : Only attachments and files older than this many days}';

    protected $description = 'Remove pictures and files no text names any more, and files without a media row';

    public function handle(PruneAttachments $prune): int
    {
        $age = (string) $this->option('min-age');
        if (preg_match('/^[1-9][0-9]{0,5}$/', $age) !== 1) {
            $this->error('--min-age is a whole number of days, at least 1.');

            return self::FAILURE;
        }
        $dryRun = (bool) $this->option('dry-run');

        $attachments = $prune->handle(Actor::system(User::defaultBot(), 'prune_attachments'), (int) $age, $dryRun);
        foreach ($attachments as $attachment) {
            $this->line("{$attachment['project']}  {$attachment['id']}  {$attachment['filename']}  ".self::megabytes($attachment['size']));
        }

        $folders = $prune->folders((int) $age, $dryRun);
        foreach ($folders as $folder) {
            $this->line("orphaned files  {$folder['folder']}  ".self::megabytes($folder['size']));
        }

        $count = count($attachments);
        $this->info(sprintf(
            '%s %d %s (%s).',
            $dryRun ? 'Would prune' : 'Pruned',
            $count,
            Str::plural('attachment', $count),
            self::megabytes(array_sum(array_column($attachments, 'size'))),
        ));

        if ($folders !== []) {
            $count = count($folders);
            $this->info(sprintf(
                '%s %d %s of orphaned files (%s).',
                $dryRun ? 'Would remove' : 'Removed',
                $count,
                Str::plural('folder', $count),
                self::megabytes(array_sum(array_column($folders, 'size'))),
            ));
        }

        return self::SUCCESS;
    }

    private static function megabytes(int $bytes): string
    {
        return number_format($bytes / 1024 / 1024, 1).' MB';
    }
}
