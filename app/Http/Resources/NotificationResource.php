<?php

namespace App\Http\Resources;

use App\Models\Notification;
use App\Models\NotificationMail;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A notification of the inbox (`Notification` of the clickdummy's types.ts, `event` being the kind, K16), with the
 * excerpt of the current text for its reader (`excerpt`, A272, K13), when its mail went (`mailed_at`, `sent_at` of its
 * collection, only when one went out) and its item, lean (WorkItemResource without description, P17; `null` without an
 * item). `data` is always an object. It asks the database nothing: only after Notification::loadForResource().
 *
 * @mixin Notification
 */
final class NotificationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Notification $notification */
        $notification = $this->resource;

        return [
            'id' => $notification->id,
            'user_id' => $notification->user_id,
            'event' => $notification->kind->value,
            'event_id' => $notification->event_id,
            'project_id' => $notification->project_id,
            'work_item_id' => $notification->work_item_id,
            'actor_id' => $notification->actor_id,
            'data' => (object) $notification->data,
            'excerpt' => $notification->excerpt,
            'read_at' => $notification->read_at?->toJSON(),
            // a skipped collection has `sent_at` too (K8), but no mail went out
            'mailed_at' => $notification->mail?->outcome === NotificationMail::SENT ? $notification->mail->sent_at?->toJSON() : null,
            'created_at' => $notification->created_at?->toJSON(),
            'item' => $notification->workItem === null ? null : new WorkItemResource($notification->workItem),
        ];
    }
}
