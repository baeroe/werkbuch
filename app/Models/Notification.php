<?php

namespace App\Models;

use App\Access\OrgRole;
use App\Access\Visibility;
use App\Domain\Notifications\NotificationKind;
use App\RichText\Document;
use App\Support\ReaderNames;
use Database\Factories\NotificationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
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

    /** The length of an excerpt in characters (A272). */
    public const EXCERPT_LENGTH = 160;

    /** With microseconds (`read_at`, `created_at`, `updated_at` are timestamp(6)): the inbox pages by the moment. */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * Set by loadForResource(), never stored: the first 160 characters of the current text the notification is about,
     * as its reader sees it (A272, K13), or `null`.
     */
    public ?string $excerpt = null;

    /**
     * Loads everything NotificationResource reads, for a list of one reader, with a fixed number of queries (none per
     * notification): the mail collection (`mailed_at`), the items, lean (WorkItem::loadForResource), and the excerpts.
     * An excerpt comes from the text as it is now, never from the time of the event (textsOf()). It is written for the
     * reader (ReaderNames): a reference to
     * an item they do not see reads as hidden, without key or title (A229). One query for the comments, at most two for
     * the names of all texts.
     *
     * @param  EloquentCollection<int, self>  $notifications
     */
    public static function loadForResource(EloquentCollection $notifications, User $reader): void
    {
        $notifications->load(['mail:id,sent_at,outcome', 'workItem']);
        $items = (new WorkItem)->newCollection($notifications->pluck('workItem')->filter()->unique('id')->values()->all());
        if ($items->isNotEmpty()) {
            WorkItem::loadForResource($items, $reader, lean: true);
        }

        $texts = self::textsOf($notifications);
        $names = ReaderNames::of(array_values($texts), $reader);

        foreach ($notifications as $notification) {
            $text = $texts[$notification->id] ?? null;
            $notification->excerpt = $text === null ? null : mb_substr(Document::fromJson($text)->toText($names), 0, self::EXCERPT_LENGTH);
        }
    }

    /**
     * The stored text each notification is about, as Tiptap JSON by notification, as it is now (A272, K13): the comment
     * of a `comment` or of a `mentioned` with `comment_id` (none once it is deleted, A228), the description of a
     * `mentioned` in it (`source: description`), none for anything else. One query for the comments; the items must be
     * loaded (`workItem`).
     *
     * @param  EloquentCollection<int, self>  $notifications
     * @return array<string, array<string, mixed>>
     */
    public static function textsOf(EloquentCollection $notifications): array
    {
        $commentIds = $notifications->map(fn (self $n) => self::commentIdOf($n))->filter()->unique()->values()->all();
        $comments = $commentIds === [] ? collect() : Comment::query()->whereKey($commentIds)->get(['id', 'body'])->keyBy('id');

        $texts = [];
        foreach ($notifications as $notification) {
            $commentId = self::commentIdOf($notification);
            $text = match (true) {
                $commentId !== null => $comments->get($commentId)?->body,
                $notification->kind === NotificationKind::Mentioned && ($notification->data['source'] ?? null) === 'description' => $notification->workItem?->description,
                default => null,
            };
            if ($text !== null) {
                $texts[$notification->id] = $text;
            }
        }

        return $texts;
    }

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
     * The inbox of the person (the one place of it): their rows with `inbox` on that they may still see (visibleTo). The
     * list, the read marks and the policy read it through here.
     *
     * @param  Builder<self>  $query
     */
    public function scopeInboxOf(Builder $query, User $user): void
    {
        $query->where($query->qualifyColumn('user_id'), $user->id)->where($query->qualifyColumn('inbox'), true)->visibleTo($user);
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

    /** The comment whose text the excerpt shows: of a `comment`, or of a `mentioned` in a comment. */
    private static function commentIdOf(self $notification): ?string
    {
        $id = $notification->data['comment_id'] ?? null;

        return in_array($notification->kind, [NotificationKind::Comment, NotificationKind::Mentioned], true) && is_string($id) ? $id : null;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['kind' => NotificationKind::class, 'data' => 'array', 'inbox' => 'boolean', 'read_at' => 'datetime'];
    }
}
