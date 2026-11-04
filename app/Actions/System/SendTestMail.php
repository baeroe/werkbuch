<?php

namespace App\Actions\System;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Mail\TestMail;
use App\Models\Organization;
use App\Support\Actor;
use App\Support\MailSetup;
use Illuminate\Support\Facades\Mail;
use Lorisleiva\Actions\Concerns\AsAction;
use Symfony\Component\Mailer\Exception\TransportExceptionInterface;

/**
 * The test mail of the system page (A287): sent at once, not over the queue, to the org admin who asks, in their
 * language (`preferredLocale()`, K19), so the page shows a refusing mail server right away. Without a mail server 409
 * `mail_not_configured`; a server that refuses is reported with its cause and answers 503 `mail_failed` (Rendering does
 * not report that 503 a second time). Nothing is written, no event. Answers the address.
 */
final class SendTestMail
{
    use AsAction;

    public function handle(Actor $actor): string
    {
        Authorize::check($actor, 'viewSystem', Organization::class);

        if (! MailSetup::configured()) {
            throw Problem::conflict('mail_not_configured');
        }

        $person = $actor->user;

        try {
            Mail::to($person)->locale($person->preferredLocale())->send(new TestMail($person->name, Organization::current()->name));
        } catch (TransportExceptionInterface $failure) {
            report($failure);

            throw Problem::unavailable('mail_failed');
        }

        return (string) $person->email;
    }
}
