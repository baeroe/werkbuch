<?php

namespace App\Notifications;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Notifications\Messages\MailMessage;

/**
 * The mail with the reset link, in the texts of the app. The link comes from ResetPassword::createUrlUsing()
 * (FortifyServiceProvider): always on APP_URL, never on the host of the request.
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
}
