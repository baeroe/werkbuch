<?php

namespace App\Support;

use App\Models\Organization;

/**
 * The lock on the organization row, the first lock of every transaction that takes one (organization, then project,
 * then items; P1). Callers stand in their own transaction.
 *
 * - `take()`, `for update`: every rule over several rows of the catalogs (one default workflow, the order of states, a
 *   workflow in use, unique names), and every change of the catalogs that rewrites items.
 * - `share()`, `lock in share mode`: every change of work items. They run side by side, and wait for a change of the
 *   catalogs (and it for them), so an item never ends up in a state or type a change of the catalogs just took away.
 *   It answers the row as locked: zone and language for the work under it (K3), never the scoped copy read before.
 */
final class CatalogLock
{
    public static function take(): void
    {
        Organization::query()->lockForUpdate()->sole();
    }

    public static function share(): Organization
    {
        return Organization::query()->sharedLock()->sole();
    }
}
