<?php

namespace App\Actions\GitHub;

use App\Jobs\ProcessGitHubDelivery;
use App\Models\GitHubDelivery;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Takes a webhook delivery of GitHub whose signature VerifyGitHubSignature checked (spec 11.4): one row per delivery ID with the app that sent it (A680)
 * (`insertOrIgnore` on the unique index: a redelivery or a second request with the same ID changes nothing) and, for a
 * new one, a job after the commit that works it. Answers whether it was new. The actor is the system (A517).
 */
final class ReceiveGitHubDelivery
{
    use AsAction;

    /**
     * @param  array{app?: string|null, delivery?: mixed, event?: mixed, body?: mixed}  $input  the app the signature names, the headers `X-GitHub-Delivery`, `X-GitHub-Event` and the raw body
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): bool
    {
        $delivery = $input['delivery'] ?? null;
        $event = $input['event'] ?? null;
        $body = $input['body'] ?? null;
        $payload = is_string($body) ? json_decode($body, true) : null;

        $errors = [];
        if (! is_string($delivery) || preg_match('/^[A-Za-z0-9-]{1,100}\z/', $delivery) !== 1) {
            $errors['delivery'] = __('field.delivery.github');
        }
        if (! is_string($event) || preg_match('/^[a-z_]{1,64}\z/', $event) !== 1) {
            $errors['event'] = __('field.event.github');
        }
        if (! is_array($payload) || array_is_list($payload)) {
            $errors['payload'] = __('field.payload.github');
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        /** @var string $delivery */
        /** @var string $event */
        /** @var string $body */
        /** @var array<string, mixed> $payload */
        $action = $payload['action'] ?? null;

        $app = $input['app'] ?? null;

        return DB::transaction(function () use ($app, $delivery, $event, $body, $action): bool {
            $id = (string) Str::ulid();
            $new = GitHubDelivery::query()->insertOrIgnore([
                'id' => $id, 'github_app_id' => $app, 'delivery_id' => $delivery, 'event' => $event,
                'action' => is_string($action) ? mb_substr($action, 0, 64) : null,
                'payload' => $body, 'received_at' => now(),
            ]) === 1;

            if ($new) {
                ProcessGitHubDelivery::dispatch($id)->afterCommit();
            }

            return $new;
        });
    }
}
