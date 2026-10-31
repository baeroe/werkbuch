<?php

namespace App\Console\Commands;

use App\Actions\Setup\SyncRoles;
use Illuminate\Console\Command;

/**
 * Brings the roles and rights in the database in line with App\Access\Grants (the migration does the same).
 */
class SyncRolesCommand extends Command
{
    protected $signature = 'app:sync-roles';

    protected $description = 'Create and update the fixed roles and permissions';

    public function handle(): int
    {
        SyncRoles::run();
        $this->info('Roles and permissions are in sync.');

        return self::SUCCESS;
    }
}
