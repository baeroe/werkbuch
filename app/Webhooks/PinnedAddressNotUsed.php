<?php

namespace App\Webhooks;

use RuntimeException;

/**
 * curl connected to another address than the checked ones (K5): a guard for the case that it did not take the entry of
 * CURLOPT_RESOLVE. The try counts as a failure, and the case is reported.
 */
final class PinnedAddressNotUsed extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('pinned address not used');
    }
}
