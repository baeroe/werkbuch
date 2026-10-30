<?php

namespace App\Console\Commands;

use App\Events\Outbox;
use Illuminate\Console\Command;

/**
 * Runs every minute (routes/console.php): dispatches events whose dispatch never ran after the commit.
 */
class RedispatchEventsCommand extends Command
{
    protected $signature = 'app:redispatch-events';

    protected $description = 'Dispatch again the events whose dispatch has not run within two minutes';

    public function handle(Outbox $outbox): int
    {
        $this->info("Redispatched {$outbox->redispatchStale()} events.");

        return self::SUCCESS;
    }
}
