<?php

namespace App\Support;

use App\Models\Organization;

/**
 * The lock every rule over several rows of the catalogs takes first (one default workflow, the order of states, a
 * workflow in use, unique names): the organization row, `for update`. Callers stand in their own transaction, and take
 * it before the lock of a project (organization, then project).
 */
final class CatalogLock
{
    public static function take(): void
    {
        Organization::query()->lockForUpdate()->sole();
    }
}
