<?php

namespace App\Actions\Webhooks;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Webhook;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One webhook, for accounts with `org.manage` (never its secret: the resource has none).
 */
final class GetWebhook
{
    use AsAction;

    /**
     * @throws Problem 403
     */
    public function handle(Actor $actor, Webhook $webhook): Webhook
    {
        Authorize::check($actor, 'manageWebhooks', Organization::class);

        return $webhook;
    }
}
