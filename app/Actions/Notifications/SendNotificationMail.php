<?php

namespace App\Actions\Notifications;

use App\Access\Visibility;
use App\Domain\Notifications\Channel;
use App\Domain\Notifications\Preferences;
use App\Mail\NotificationDigest;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\NotificationPreference;
use App\Models\User;
use App\RichText\Document;
use App\Support\Actor;
use App\Support\ReaderNames;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Sends a mail collection that is due (phase plan 8 "Mail", A273), at most once: the collection is locked first and a
 * sent one (`sent_at`) does nothing, so two jobs of the same collection send one mail. Whether a line still goes out is
 * decided now, not when it was collected (Review Focus 3): the person active and a person, the project one they see
 * (Notification::visibleTo, read afresh; never through NotificationPolicy, which is the inbox's), the item there, the
 * line unread (a read one needs no mail) and mail still on for its kind. Nothing left: `skipped`, closed like a sent one
 * (K8). The texts are the current ones, written for the person (ReaderNames: a reference to an item they do not see
 * stays hidden, A229). Closing removes `open_key`, so a line arriving from now on opens a new collection (K7). When SMTP
 * fails, everything rolls back and the job tries again; a crash between SMTP and the commit may send twice (A273). Work
 * of a job without an event of its own.
 */
final class SendNotificationMail
{
    use AsAction;

    /** The collection was sent or skipped before (or is gone): nothing to do. */
    public const ALREADY = 'already';

    /**
     * @return string `sent`, `skipped` or `already`
     */
    public function handle(Actor $actor, string $mailId): string
    {
        return DB::transaction(function () use ($mailId): string {
            // the lock comes first: the locking read of the lines below sees every line a consumer committed meanwhile
            $mail = NotificationMail::query()->lockForUpdate()->find($mailId);
            if ($mail === null || $mail->sent_at !== null) {
                return self::ALREADY;
            }

            $person = User::query()->findOrFail($mail->user_id);
            $lines = $this->lines($mail, $person);
            if ($lines->isNotEmpty()) {
                $texts = Notification::textsOf($lines);
                $digest = new NotificationDigest(
                    $person,
                    array_values($lines->map(fn (Notification $line) => ['notification' => $line, 'text' => isset($texts[$line->id]) ? Document::fromJson($texts[$line->id]) : null])->all()),
                    ReaderNames::of(array_values($texts), $person),
                    reminders: str_starts_with($mail->scope, 'due:'),
                );
                Mail::to($person)->locale($person->preferredLocale())->send($digest);
            }

            $outcome = $lines->isEmpty() ? NotificationMail::SKIPPED : NotificationMail::SENT;
            $mail->update(['open_key' => null, 'sent_at' => now(), 'outcome' => $outcome]);

            return $outcome;
        }, 3);
    }

    /**
     * The lines that still go out, oldest first, with their items and actors; read with a shared lock, so they are the
     * latest and stay as they are until the mail went.
     *
     * @return EloquentCollection<int, Notification>
     */
    private function lines(NotificationMail $mail, User $person): EloquentCollection
    {
        if (! $person->isPerson() || $person->isDisabled()) {
            return new EloquentCollection;
        }

        Visibility::forget();
        $stored = NotificationPreference::storedFor([$person->id])[$person->id] ?? [];

        return Notification::query()->where('mail_id', $mail->id)->whereNull('read_at')->visibleTo($person)
            ->with(['workItem.project', 'actor'])->orderBy('created_at')->orderBy('id')->sharedLock()->get()
            ->filter(fn (Notification $line) => $line->workItem !== null && Preferences::enabled($line->kind, Channel::Mail, $stored))
            ->values();
    }
}
