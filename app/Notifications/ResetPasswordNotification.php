<?php

namespace App\Notifications;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;

/**
 * The mail with the reset link, in the texts of the app. It goes out from a queued job, so nothing in it depends on a
 * request: the link always points to APP_URL, never to the host of a request (a forged Host header must not lead the
 * mail elsewhere). It is a job of its own on the queue `notifications`, after the commit: a mail server that fails is
 * tried again with the same token (the link of App\Actions\Auth\SendPasswordResetLink runs once). The token travels
 * encrypted, in `jobs` and in `failed_jobs`.
 */
final class ResetPasswordNotification extends ResetPassword implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(#[\SensitiveParameter] string $token)
    {
        parent::__construct($token);

        $this->onQueue('notifications')->afterCommit();
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [60, 300, 900, 3600];
    }

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
