<?php

namespace App\Webhooks;

use RuntimeException;

/**
 * A receiver answered with more than DeliverWebhook::RESPONSE_MAX bytes (K4): the transfer stops there, the log keeps
 * only 2 KB anyway, and the try counts as a failure (`too_large`).
 */
final class ResponseTooLarge extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('Webhook answer too large');
    }
}
