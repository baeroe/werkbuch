<?php

namespace App\Notifications;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Notifications\Messages\MailMessage;

/**
 * The mail with the reset link, in the texts of the app. It goes out from a queued job, so nothing in it depends on a
 * request: the link always points to APP_URL, never to the host of a request (a forged Host header must not lead the
 * mail elsewhere).
 */
final class ResetPasswordNotification extends ResetPassword
{
    /**
     * @param  User  $notifiable
     */
    public function toMail($notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject(__('mail.reset_password.subject'))
            ->greeting(__('mail.reset_password.greeting', ['name' => $notifiable->name]))
            ->line(__('mail.reset_password.intro'))
            ->action(__('mail.reset_password.action'), $this->resetUrl($notifiable))
            ->line(__('mail.reset_password.expiry', ['minutes' => config('auth.passwords.'.config('auth.defaults.passwords').'.expire')]))
            ->line(__('mail.reset_password.outro'));
    }

    /**
     * @param  User  $notifiable
     */
    protected function resetUrl($notifiable): string
    {
        return rtrim((string) config('app.url'), '/').'/reset-password/'.$this->token.'?email='.urlencode((string) $notifiable->email);
    }
}
