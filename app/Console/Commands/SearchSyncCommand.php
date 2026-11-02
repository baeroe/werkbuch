<?php

namespace App\Console\Commands;

use App\Search\SearchIndexer;
use Illuminate\Console\Command;

/**
 * Sends the index settings of config/scout.php to the search engine (after a deploy that changed them).
 */
class SearchSyncCommand extends Command
{
    protected $signature = 'app:search-sync';

    protected $description = 'Send the settings of the search indexes to the search engine';

    public function handle(SearchIndexer $indexer): int
    {
        $indexer->syncSettings();

        $this->info('Search settings synced.');

        return self::SUCCESS;
    }
}
