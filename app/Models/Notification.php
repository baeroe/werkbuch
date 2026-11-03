<?php

namespace App\Models;

use App\Access\OrgRole;
use App\Access\Visibility;
use App\Domain\Notifications\NotificationKind;
use Database\Factories\NotificationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * What a person learns about an event or a reminder (spec 4.14): one row per person and event or reminder
 * (`dedupe_key`), shown in the inbox when `inbox` is on (A271) and collected into a mail (`mail_id`). Not to be confused
 * with Illuminate\Notifications\Notification: App\Notifications\* are the Laravel notifications of the sign-in mails.
 * Whether its person still sees it is decided when it is read or sent (scope `visibleTo`), never when it is written.
 *
 * @property string $id
 * @property string $user_id
 * @property NotificationKind $kind
 * @property string|null $event_id
 * @property string|null $project_id
 * @property string|null $work_item_id
 * @property string|null $actor_id
 * @property array<string, mixed> $data
 * @property bool $inbox
 * @property string|null $mail_id
 * @property string $dedupe_key
 * @property Carbon|null $read_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $user
 * @property-read Project|null $project
 * @property-read WorkItem|null $workItem
 * @property-read User|null $actor
 * @property-read NotificationMail|null $mail
 * @property-read Event|null $event
 */
#[Fillable(['user_id', 'kind', 'event_id', 'project_id', 'work_item_id', 'actor_id', 'data', 'inbox', 'mail_id', 'dedupe_key', 'read_at'])]
final class Notification extends Model
{
    /** @use HasFactory<NotificationFactory> */
    use HasFactory, HasUlids;

    /** With microseconds (`read_at`, `created_at`, `updated_at` are timestamp(6)): the inbox pages by the moment. */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * Only what the person may still see (K5, the one place of this rule): a notification of a project the person sees
     * (App\Access\Visibility: never a project being deleted, nothing for a deactivated account), or an organization
     * notification without a project (`webhook_disabled`) while the person is an org admin. Whose row it is, the caller
     * decides.
     *
     * @param  Builder<self>  $query
     */
    public function scopeVisibleTo(Builder $query, User $user): void
    {
        $orgAdmin = ! $user->isDisabled() && Visibility::orgRole($user) === OrgRole::Admin;

        $query->where(fn (Builder $visible) => $visible
            ->whereIn($query->qualifyColumn('project_id'), Visibility::projectIds($user))
            ->when($orgAdmin, fn (Builder $or) => $or->orWhere(fn (Builder $org) => $org
                ->whereNull($query->qualifyColumn('project_id'))
                ->where($query->qualifyColumn('kind'), NotificationKind::WebhookDisabled))));
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * @return BelongsTo<WorkItem, $this>
     */
    public function workItem(): BelongsTo
    {
        return $this->belongsTo(WorkItem::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    /**
     * The mail collection the notification went (or goes) into.
     *
     * @return BelongsTo<NotificationMail, $this>
     */
    public function mail(): BelongsTo
    {
        return $this->belongsTo(NotificationMail::class, 'mail_id');
    }

    /**
     * @return BelongsTo<Event, $this>
     */
    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['kind' => NotificationKind::class, 'data' => 'array', 'inbox' => 'boolean', 'read_at' => 'datetime'];
    }
}
