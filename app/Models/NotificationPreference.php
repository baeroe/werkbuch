<?php

namespace App\Models;

use App\Domain\Notifications\Channel;
use App\Domain\Notifications\NotificationKind;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * The choice of a person for one kind of notification and one channel (spec 4.14). Without a row the default holds
 * (App\Domain\Notifications\Preferences::enabled).
 *
 * @property string $id
 * @property string $user_id
 * @property NotificationKind $kind
 * @property Channel $channel
 * @property bool $enabled
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['user_id', 'kind', 'channel', 'enabled'])]
final class NotificationPreference extends Model
{
    use HasUlids;

    /**
     * The stored choices of the accounts, `"<kind>:<channel>" => enabled` per account (the form Preferences::enabled
     * reads), in one query.
     *
     * @param  list<string>  $userIds
     * @return array<string, array<string, bool>>
     */
    public static function storedFor(array $userIds): array
    {
        $stored = [];
        foreach (self::query()->whereIn('user_id', $userIds)->get() as $preference) {
            $stored[$preference->user_id]["{$preference->kind->value}:{$preference->channel->value}"] = $preference->enabled;
        }

        return $stored;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['kind' => NotificationKind::class, 'channel' => Channel::class, 'enabled' => 'boolean'];
    }
}
