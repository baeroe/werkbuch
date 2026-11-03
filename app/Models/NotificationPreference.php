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
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['kind' => NotificationKind::class, 'channel' => Channel::class, 'enabled' => 'boolean'];
    }
}
