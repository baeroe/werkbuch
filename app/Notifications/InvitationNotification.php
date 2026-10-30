<?php

namespace App\Notifications;

use App\Models\Invitation;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * The mail with the invitation link, in the texts of the app and the language of the organization (the invited person
 * has no account yet). It goes out from the queue `notifications` after the commit; the link is made when the invitation
 * is created (always behind APP_URL), so the job needs nothing but these texts.
 */
final class InvitationNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(private readonly string $link, private readonly string $organization, private readonly string $inviter)
    {
        $this->onQueue('notifications')->afterCommit();
    }

    /**
     * @return list<string>
     */
    public function via(mixed $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(mixed $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject(__('mail.invitation.subject', ['organization' => $this->organization]))
            ->greeting(__('mail.layout.hello'))
            ->line(__('mail.invitation.intro', ['inviter' => $this->inviter, 'organization' => $this->organization]))
            ->action(__('mail.invitation.action'), $this->link)
            ->line(__('mail.invitation.expiry', ['days' => Invitation::VALID_DAYS]))
            ->line(__('mail.invitation.outro'));
    }
}
