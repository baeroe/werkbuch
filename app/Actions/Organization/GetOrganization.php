<?php

namespace App\Actions\Organization;

use App\Models\Organization;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The organization; every account sees it.
 */
final class GetOrganization
{
    use AsAction;

    public function handle(Actor $actor): Organization
    {
        return Organization::current();
    }
}
