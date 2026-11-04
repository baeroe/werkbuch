<?php

namespace App\Console\Commands;

use App\Search\SearchIndexer;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Builds the search indexes from scratch: the first start, and the repair when the search consumer lost something.
 */
class SearchImportCommand extends Command
{
    protected $signature = 'app:search-import';

    protected $description = 'Build the search indexes from scratch, with their settings';

    public function handle(SearchIndexer $indexer): int
    {
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
