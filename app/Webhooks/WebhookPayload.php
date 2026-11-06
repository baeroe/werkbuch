<?php

namespace App\Webhooks;

use App\Events\EventType;
use App\Models\Event;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Support\RelationChanges;

/**
 * The body of a webhook (plan "Payload und Header", spec 6.3): `{id, event, occurred_at, actor, project, data, changes}`
 * for one reader (the bot of the webhook, else the default bot, A363). `data` comes from the resources (EventData),
 * `changes` are those of the event with the relation ends resolved for the reader (RelationChanges, like the history)
 * and without the text of a comment that is gone (A228). Nothing of `meta` ever leaves: not `socket` (A282),
 * `on_behalf_of` (A342), `quiet` (A357), `mentioned`, `kept_version`; the small forms of deletions take only their
 * named fields. The body is built once when the event is consumed and stored encoded (encode(), task 6, A362).
 */
final class WebhookPayload
{
    /**
     * The most a body may have in bytes (T5-M2): a description of 256 KB stands in `data` twice (Markdown and JSON) and
     * in `changes` as old and new, rich text values come on top; a body over this goes out without `changes`, and if
     * still too large without `data` too (like a subject that is gone, A362): the receiver reads the subject over REST.
     */
    public const MAX_BYTES = 1_048_576;

    /**
     * The body as it is stored and sent: JSON with slashes and Unicode as they are, within MAX_BYTES.
     *
     * @param  array<string, mixed>  $payload
     */
    public static function encode(array $payload): string
    {
        $json = self::json($payload);
        if (strlen($json) > self::MAX_BYTES) {
            $json = self::json([...$payload, 'changes' => null]);
        }
        if (strlen($json) > self::MAX_BYTES) {
            $json = self::json([...$payload, 'data' => null, 'changes' => null]);
        }

        return $json;
    }

    /**
     * @return array{id: string, event: string, occurred_at: string, actor: array{id: string, type: string, name: string, handle: string}, project: array{id: string, identifier: string|null}|null, data: array<string, mixed>|null, changes: array<string, mixed>|null}
     */
    public static function for(Event $event, User $reader): array
    {
        RelationChanges::forReader([$event], $reader);
        $data = EventData::of($event, $reader);

        return [
            'id' => $event->id,
            'event' => $event->type->value,
            'occurred_at' => $event->occurred_at->toJSON(),
            'actor' => self::actor($event->actor()->firstOrFail()),
            'project' => self::project($event),
            'data' => $data,
            'changes' => self::changes($event, $data),
        ];
    }

    /**
     * The body of a test ping: the delivery stands in for the event.
     *
     * @return array{id: string, event: string, occurred_at: string, actor: array{id: string, type: string, name: string, handle: string}, project: array{id: string, identifier: string}|null, data: array{webhook: array{id: string, name: string}}, changes: null}
     */
    public static function ping(Webhook $webhook, User $actor, string $deliveryId): array
    {
        $project = $webhook->project;

        return [
            'id' => $deliveryId,
            'event' => 'ping',
            'occurred_at' => now()->toJSON(),
            'actor' => self::actor($actor),
            'project' => $project === null ? null : ['id' => $project->id, 'identifier' => $project->identifier],
            'data' => ['webhook' => ['id' => $webhook->id, 'name' => $webhook->name]],
            'changes' => null,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private static function json(array $payload): string
    {
        return json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /**
     * @return array{id: string, type: string, name: string, handle: string}
     */
    private static function actor(User $user): array
    {
        return ['id' => $user->id, 'type' => $user->type->value, 'name' => $user->name, 'handle' => $user->handle];
    }

    /**
     * The project of the event with its current identifier; a deleted project only the event knows (`meta.identifier`).
     *
     * @return array{id: string, identifier: string|null}|null
     */
    private static function project(Event $event): ?array
    {
        if ($event->project_id === null) {
            return null;
        }
        $identifier = Project::query()->whereKey($event->project_id)->value('identifier');
        $stored = $event->type === EventType::ProjectDeleted ? ($event->meta['identifier'] ?? null) : null;

        return ['id' => $event->project_id, 'identifier' => is_string($identifier) ? $identifier : (is_string($stored) ? $stored : null)];
    }

    /**
     * `changes` for the reader. The texts of an edited comment go only with the comment: once it is gone (or the reader
     * does not see it, `data` is null then too), the edit names nothing of what it said.
     *
     * @param  array<string, mixed>|null  $data
     * @return array<string, mixed>|null
     */
    private static function changes(Event $event, ?array $data): ?array
    {
        $changes = $event->history_changes;
        if ($changes !== null && $event->type === EventType::CommentUpdated && $data === null) {
            unset($changes['body']);
        }

        return $changes === [] ? null : $changes;
    }
}
