<?php

namespace App\Console\Commands;

use App\Search\SearchIndexer;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Builds the search indexes from scratch: the first start, the start after an update that changed the documents
 * (--if-empty decides) and the repair when the search consumer lost something.
 */
class SearchImportCommand extends Command
{
    protected $signature = 'app:search-import {--if-empty : Import only when an index lacks documents of its table or their fields differ from today\'s}';

    protected $description = 'Build the search indexes from scratch, with their settings';

    public function handle(SearchIndexer $indexer): int
    {
        if ($this->option('if-empty') && ! $indexer->needsImport()) {
            $this->info('The search indexes have their documents; nothing imported.');

            return self::SUCCESS;
        }

        ['work_items' => $items, 'pages' => $pages, 'projects' => $projects, 'users' => $users] = $indexer->rebuild();

        $this->info(sprintf(
            'Indexed %d %s, %d %s, %d %s, %d %s.',
            $items, Str::plural('work item', $items),
            $pages, Str::plural('page', $pages),
            $projects, Str::plural('project', $projects),
            $users, Str::plural('account', $users),
        ));

        return self::SUCCESS;
    }
}
