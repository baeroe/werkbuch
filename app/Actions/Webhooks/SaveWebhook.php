<?php

namespace App\Actions\Webhooks;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Webhook;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\WebhookInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a webhook (accounts with `org.manage`, spec 4.3) or replaces one as a whole (A75). Creating makes the secret
 * (A369): it is in the answer of this call only, never taken from the input, never in an event. A change reads the row
 * afresh under `lockForUpdate` (a deletion or another change at the same time waits, and this one compares with what
 * that one left); only what really changes is written and recorded, the same input again writes nothing. Switching a
 * webhook on again clears `disabled_at` and `failing_since` (A366): it starts afresh, nothing is sent again.
 */
final class SaveWebhook
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `name`, `url`, `project_id`, `events`, `bot_id`, `active`
     * @return array{webhook: Webhook, secret: ?string} the secret only for a new webhook
     *
     * @throws ValidationException
     * @throws Problem 403, or 404 for a webhook deleted meanwhile
     */
    public function handle(Actor $actor, array $input, ?Webhook $webhook = null): array
    {
        Authorize::check($actor, 'manageWebhooks', Organization::class);

        if ($webhook === null) {
            return DB::transaction(function () use ($actor, $input): array {
                $valid = WebhookInput::validate($input, null);
                $secret = Webhook::newSecret();
                $created = Webhook::query()->create([...$valid, 'secret' => $secret, 'created_by' => $actor->user->id]);
                EventRecorder::record(EventType::WebhookCreated, $actor, $created, $created->project, [
                    'name' => ['old' => null, 'new' => $created->name],
                ]);

                return ['webhook' => $created, 'secret' => $secret];
            }, 3);
        }

        return DB::transaction(function () use ($actor, $input, $webhook): array {
            $current = Webhook::query()->lockForUpdate()->find($webhook->id) ?? throw Problem::notFound();
            $valid = WebhookInput::validate($input, $current);

            $changes = CatalogInput::changes(self::snapshot($current), $valid);
            if ($changes === []) {
                return ['webhook' => $current, 'secret' => null];
            }

            $current->fill($valid);
            if (! $current->getOriginal('active') && $valid['active']) {
                if ($current->disabled_at !== null) {
                    $changes['disabled_at'] = ['old' => $current->disabled_at->toJSON(), 'new' => null];
                }
                $current->fill(['disabled_at' => null, 'failing_since' => null]);
            }
            $current->save();

            EventRecorder::record(EventType::WebhookUpdated, $actor, $current, $current->project, $changes);

            return ['webhook' => $current, 'secret' => null];
        }, 3);
    }

    /**
     * What an event compares: the stored columns of the input.
     *
     * @return array{name: string, url: string, project_id: ?string, events: list<string>, bot_id: ?string, active: bool}
     */
    private static function snapshot(Webhook $webhook): array
    {
        return [
            'name' => $webhook->name, 'url' => $webhook->url, 'project_id' => $webhook->project_id, 'events' => $webhook->events,
            'bot_id' => $webhook->bot_id, 'active' => $webhook->active,
        ];
    }
}
