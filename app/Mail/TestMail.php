<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * The test mail of the system page (SendTestMail): a short mail that says the mail server works, who asked for it and
 * where werkbuch lives. Own Blade views with inline styles like NotificationDigest, rendered in the language the sender
 * gives it (`locale()`); it asks the database nothing.
 */
final class TestMail extends Mailable
{
    public function __construct(private readonly string $person, private readonly string $organization) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: __('mail.test.subject'));
    }

    public function content(): Content
    {
        return new Content(view: 'mail.test', text: 'mail.test-text', with: [
            'heading' => __('mail.test.heading'),
            'body' => __('mail.test.body', ['name' => $this->person, 'organization' => $this->organization]),
            'appUrl' => rtrim((string) config('app.url'), '/'),
        ]);
    }
}
