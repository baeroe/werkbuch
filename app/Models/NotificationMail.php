<?php

namespace App\Models;

use Database\Factories\NotificationMailFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A collection of notification lines that goes out as one mail (spec 4.14): per person and item (`scope`
 * `item:<ulid>`) or per person and day of reminders (`due:<Y-m-d>`). `open_key` (`<user_id>:<scope>`) is set while
 * new lines may join; once sent (or skipped), `sent_at` and `outcome` (`sent`, `skipped`) say so.
 *
 * @property string $id
 * @property string $user_id
 * @property string $scope
 * @property string|null $open_key
 * @property Carbon $due_at
 * @property Carbon|null $sent_at
 * @property string|null $outcome
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $user
 */
#[Fillable(['user_id', 'scope', 'open_key', 'due_at', 'sent_at', 'outcome'])]
final class NotificationMail extends Model
{
    /** @use HasFactory<NotificationMailFactory> */
    use HasFactory, HasUlids;

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * The lines of the mail.
     *
     * @return HasMany<Notification, $this>
     */
    public function notifications(): HasMany
    {
        return $this->hasMany(Notification::class, 'mail_id');
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['due_at' => 'datetime', 'sent_at' => 'datetime'];
    }
}
