<?php

namespace App\Actions\Notifications;

use App\Access\Visibility;
use App\Domain\Notifications\Channel;
use App\Domain\Notifications\NotificationKind;
use App\Domain\Notifications\Preferences;
use App\Mail\NotificationDigest;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\NotificationPreference;
use App\Models\Template;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WorkItem;
use App\RichText\Document;
use App\Support\Actor;
use App\Support\MailSetup;
use App\Support\ReaderNames;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Lorisleiva\Actions\Concerns\AsAction;
use Throwable;

/**
 * Sends a mail collection that is due (phase plan 8 "Mail", A273), at most once: the collection is locked first and a
 * sent one (`sent_at`) does nothing, so two jobs of the same collection send one mail. Whether a line still goes out is
 * decided now, not when it was collected (Review Focus 3): the person active and a person, the project one they see
 * (Notification::visibleTo, read afresh; never through NotificationPolicy, which is the inbox's), the item there, the
 * line unread (a read one needs no mail) and mail still on for its kind, a reminder only for an item that is still
 * open, not archived and the person's (T8-M5), a failed template run only while its template is there (A348), a switched-off webhook only while it is there and still off (phase 11), and a
 * mail server still set (T7-M5). Nothing left: `skipped`, closed like a sent one (K8). The texts are the current ones,
 * written for the person (ReaderNames: a reference to an item they do not see stays hidden, A229). `open_key` goes right after the lock, before the lines are read and before SMTP: a consumer
 * collecting for the same person and item waits at its insert and opens a new collection once this one is closed (K7);
 * if it took the key first, the two meet before anything was sent, and the retry of the victim is harmless (I1 of the
 * review of Task 7: a deadlock after SMTP would send twice). When SMTP fails, everything rolls back and the job tries
 * again; a crash between SMTP and the commit may send twice (A273). A collection that still fails GIVE_UP_HOURS after it
 * was due gives up (ruling T7-I2): `failed`, closed without a mail, reported once, never dispatched again. Work of a job
 * without an event of its own.
 */
final class SendNotificationMail
{
    use AsAction;

    /** The collection was sent, skipped or given up before (or is gone): nothing to do. */
    public const ALREADY = 'already';

    /** How long after it was due a collection may keep failing before it gives up. */
    public const GIVE_UP_HOURS = 24;

    /**
     * @return string `sent`, `skipped`, `failed` or `already`
     */
    public function handle(Actor $actor, string $mailId): string
    {
        // a try: the sweeper waits for the next one (I1); outside the transaction, which a failure rolls back
        NotificationMail::query()->whereKey($mailId)->whereNull('sent_at')->update(['dispatched_at' => now()]);

        try {
            return DB::transaction(fn (): string => $this->send($mailId), 3);
        } catch (Throwable $failure) {
            if (! $this->giveUp($mailId)) {
                throw $failure;
            }
            report($failure);

            return NotificationMail::FAILED;
        }
    }

    private function send(string $mailId): string
    {
        // the lock comes first: the locking read of the lines below sees every line a consumer committed meanwhile
        $mail = NotificationMail::query()->lockForUpdate()->find($mailId);
        if ($mail === null || $mail->sent_at !== null) {
            return self::ALREADY;
        }
        // closed before anything else: a line arriving from now on opens a new collection (I1)
        $mail->update(['open_key' => null]);

        $person = User::query()->findOrFail($mail->user_id);
        $template = self::templateOf($mail);
        $webhook = self::webhookOf($mail);
        // a mail server that went away since the collection opened (`log`, `array`) sends nothing: skipped, never `sent`
        $lines = MailSetup::configured() ? $this->lines($mail, $person, $template, $webhook) : new EloquentCollection;
        if ($lines->isNotEmpty()) {
            $texts = Notification::textsOf($lines);
            $digest = new NotificationDigest(
                $person,
                array_values($lines->map(fn (Notification $line) => ['notification' => $line, 'text' => isset($texts[$line->id]) ? Document::fromJson($texts[$line->id]) : null])->all()),
                ReaderNames::of(array_values($texts), $person),
                reminders: str_starts_with($mail->scope, 'due:'),
                template: $template,
                webhook: $webhook,
            );
            Mail::to($person)->locale($person->preferredLocale())->send($digest);
        }

        $outcome = $lines->isEmpty() ? NotificationMail::SKIPPED : NotificationMail::SENT;
        $mail->update(['sent_at' => now(), 'outcome' => $outcome]);

        return $outcome;
    }

    /**
     * Closes the collection as `failed` once it is due for more than GIVE_UP_HOURS and still open; whether it did.
     */
    private function giveUp(string $mailId): bool
    {
        return DB::transaction(function () use ($mailId): bool {
            $mail = NotificationMail::query()->lockForUpdate()->find($mailId);
            if ($mail === null || $mail->sent_at !== null || $mail->due_at->copy()->addHours(self::GIVE_UP_HOURS)->isFuture()) {
                return false;
            }
            $mail->update(['open_key' => null, 'sent_at' => now(), 'outcome' => NotificationMail::FAILED]);

            return true;
        });
    }

    /**
     * The lines that still go out, oldest first, with their items and actors; read with a shared lock, so they are the
     * latest and stay as they are until the mail went.
     *
     * @return EloquentCollection<int, Notification>
     */
    private function lines(NotificationMail $mail, User $person, ?Template $template, ?Webhook $webhook): EloquentCollection
    {
        if (! $person->isPerson() || $person->isDisabled()) {
            return new EloquentCollection;
        }

        Visibility::forget();
        $stored = NotificationPreference::storedFor([$person->id])[$person->id] ?? [];

        return Notification::query()->where('mail_id', $mail->id)->whereNull('read_at')->visibleTo($person)
            ->with(['workItem.project', 'workItem.state', 'actor'])->orderBy('created_at')->orderBy('id')->sharedLock()->get()
            ->filter(fn (Notification $line) => Preferences::enabled($line->kind, Channel::Mail, $stored) && match (true) {
                // a failed run has no item: it needs its template still there (A348)
                $line->kind === NotificationKind::TemplateRunFailed => $template !== null && ($line->data['template_id'] ?? null) === $template->id,
                // a switched-off webhook has no item: it needs to be there and still off (phase 11, K12); that the person is
                // still an org admin is Notification::visibleTo
                $line->kind === NotificationKind::WebhookDisabled => $webhook !== null && ! $webhook->active && ($line->data['webhook_id'] ?? null) === $webhook->id,
                $line->workItem === null => false,
                $line->kind === NotificationKind::Due => self::stillDue($line->workItem, $person),
                default => true,
            })
            ->values();
    }

    /**
     * The template of a collection of failed runs (`template:<id>`, A348) with its project, if it is still there; null
     * for every other collection.
     */
    private static function templateOf(NotificationMail $mail): ?Template
    {
        if (! str_starts_with($mail->scope, 'template:')) {
            return null;
        }

        return Template::query()->with('project')->find(substr($mail->scope, strlen('template:')));
    }

    /**
     * The webhook of a collection of switch-offs (`webhook:<id>`, phase 11), if it is still there; null for every other
     * collection.
     */
    private static function webhookOf(NotificationMail $mail): ?Webhook
    {
        if (! str_starts_with($mail->scope, 'webhook:')) {
            return null;
        }

        return Webhook::query()->find(substr($mail->scope, strlen('webhook:')));
    }

    /**
     * Whether a reminder still holds when its mail goes (T8-M5): the item open, not archived, in a project that is not
     * archived, and still the person's.
     */
    private static function stillDue(WorkItem $item, User $person): bool
    {
        return $item->archived_at === null && $item->project->archived_at === null && $item->assignee_id === $person->id
            && ! $item->state->category->isClosed();
    }
}
