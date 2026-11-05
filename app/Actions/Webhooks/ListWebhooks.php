<?php

namespace App\Actions\Webhooks;

use App\Access\Authorize;
use App\Models\Organization;
use App\Models\Webhook;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Every webhook of the organization and its projects, by name and then ULID (a unique order for the cursor); only
 * accounts with `org.manage` read them. The list counts no deliveries per row (P5).
 */
final class ListWebhooks
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $query  `cursor`, `per_page`
     * @return ListResult<Webhook>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $query): ListResult
    {
        Authorize::check($actor, 'manageWebhooks', Organization::class);

        return ListResult::of(Webhook::query()->orderBy('name')->orderBy('id'), PageArgs::from($query));
    }
}
