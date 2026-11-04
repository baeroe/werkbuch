<?php

namespace App\Mail;

use App\Domain\Notifications\NotificationKind;
use App\Models\Notification;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\Document;
use App\RichText\RichTextNames;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Support\Carbon;

/**
 * The digest of a mail collection (phase plan 8 "Mail"): what happened to one item, a line per notification with the
 * sentence of its kind, its time in the time zone of the person and, for a comment or a mention, the current text as
 * the person may read it (Document::toMailHtml with their ReaderNames; images and files are links, nothing is attached
 * or embedded). A text longer than TEXT_MAX characters shows as plain text up to there, with a link to the item. Own
 * Blade views with inline styles in the colours of DESIGN.md, no Markdown template. It is rendered in the language the
 * sender gives it (`locale()`), and it asks the database nothing.
 *
 * A collection of reminders (`due:<day>`, A275) is about several items: its mail names each with key, title, link and
 * "due today" or "overdue since" (from `data.overdue`, the calendar of the person when it was written), the oldest due
 * date first, under a subject of its own (`reminders`).
 */
final class NotificationDigest extends Mailable
{
    /** The longest text a line quotes, in characters of plain text. */
    public const TEXT_MAX = 2000;

    /**
     * @param  list<array{notification: Notification, text: Document|null}>  $lines  oldest first, with their items
     *                                                                               and actors loaded
     */
    public function __construct(
        private readonly User $person,
        private readonly array $lines,
        private readonly RichTextNames $names,
        private readonly bool $reminders = false,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->reminders
            ? __('mail.notifications.reminders.subject')
            : __('mail.notifications.subject', ['key' => $this->item()->key, 'title' => $this->item()->title]));
    }

    public function content(): Content
    {
        $base = rtrim((string) config('app.url'), '/');
        if ($this->reminders) {
            return $this->reminderContent($base);
        }

        return new Content(view: 'mail.notifications.digest', text: 'mail.notifications.digest-text', with: [
            'key' => $this->item()->key,
            'title' => $this->item()->title,
            'itemUrl' => "{$base}/items/".rawurlencode($this->item()->key),
            'settingsUrl' => "{$base}/me/notifications",
            'entries' => array_map(fn (array $line) => $this->entry($line['notification'], $line['text'], $base), $this->lines),
        ]);
    }

    /** The reminders: one entry per item, the oldest due date first, then by key. */
    private function reminderContent(string $base): Content
    {
        $lines = array_map(fn (array $line) => $line['notification'], $this->lines);
        usort($lines, fn (Notification $a, Notification $b) => [$a->data['due_date'] ?? '', $a->workItem?->project->identifier, $a->workItem?->number]
            <=> [$b->data['due_date'] ?? '', $b->workItem?->project->identifier, $b->workItem?->number]);

        return new Content(view: 'mail.notifications.reminders', text: 'mail.notifications.reminders-text', with: [
            'subject' => __('mail.notifications.reminders.subject'),
            'myItemsUrl' => "{$base}/my-items",
            'settingsUrl' => "{$base}/me/notifications",
            'entries' => array_map(function (Notification $line) use ($base): array {
                /** @var WorkItem $item SendNotificationMail leaves out a line without its item */
                $item = $line->workItem;

                return ['key' => $item->key, 'title' => $item->title, 'url' => "{$base}/items/".rawurlencode($item->key), 'sentence' => $this->sentence($line)];
            }, $lines),
        ]);
    }

    /** The item of the collection: every line is about it. */
    private function item(): WorkItem
    {
        /** @var WorkItem $item SendNotificationMail leaves out a line without its item */
        $item = $this->lines[0]['notification']->workItem;

        return $item;
    }

    /**
     * What the views show of a line: `html` the text as mail HTML, `text` the plain text (cut after TEXT_MAX characters,
     * then without `html`).
     *
     * @return array{sentence: string, at: string, html: string|null, text: string|null, cut: bool}
     */
    private function entry(Notification $notification, ?Document $text, string $base): array
    {
        $plain = $text?->toText($this->names);
        $cut = $plain !== null && mb_strlen($plain) > self::TEXT_MAX;

        return [
            'sentence' => $this->sentence($notification),
            'at' => $notification->created_at?->copy()->setTimezone($this->person->effectiveTimezone())->settings(['locale' => app()->getLocale()])->isoFormat('LLL') ?? '',
            'html' => $text === null || $cut ? null : $text->toMailHtml($this->names, $base),
            'text' => $cut ? mb_substr((string) $plain, 0, self::TEXT_MAX).'…' : $plain,
            'cut' => $cut,
        ];
    }

    /** What the line says, in the language of the mail; a reminder that is overdue names the due date. */
    private function sentence(Notification $notification): string
    {
        if ($notification->kind === NotificationKind::Due && ($notification->data['overdue'] ?? false) === true) {
            return __('mail.notifications.reminders.overdue', [
                'day' => Carbon::parse((string) $notification->data['due_date'])->settings(['locale' => app()->getLocale()])->isoFormat('LL'),
            ]);
        }

        return __("mail.notifications.kind.{$notification->kind->value}", [
            'actor' => $notification->actor->name ?? __('mail.notifications.someone'),
            'from' => $notification->data['from']['name'] ?? '',
            'to' => $notification->data['to']['name'] ?? '',
        ]);
    }
}
