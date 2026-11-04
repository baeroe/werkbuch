<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One cell of the notification settings as `NotificationPreference` of resources/js/types.ts: a row of the matrix of
 * App\Actions\Notifications\GetNotificationPreferences (`event` is the kind, as the clickdummy names it).
 */
final class NotificationPreferenceResource extends JsonResource
{
    /**
     * @return array{user_id: string, event: string, channel: string, enabled: bool}
     */
    public function toArray(Request $request): array
    {
        /** @var array{user_id: string, event: string, channel: string, enabled: bool} $row */
        $row = $this->resource;

        return [
            'user_id' => $row['user_id'],
            'event' => $row['event'],
            'channel' => $row['channel'],
            'enabled' => $row['enabled'],
        ];
    }
}
