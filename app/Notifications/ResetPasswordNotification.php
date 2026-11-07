<?php

namespace App\Notifications;

use App\Models\User;
use DateTimeInterface;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;

/**
 * The mail with the reset link, in the texts of the app. It goes out from a queued job, so nothing in it depends on a
 * request: the link always points to APP_URL, never to the host of a request (a forged Host header must not lead the
 * mail elsewhere). It is a job of its own on the queue `mail`, after the commit: a mail server that fails is
 * tried again with the same token (the link of App\Actions\Auth\SendPasswordResetLink runs once), but only while the
 * token lives (retryUntil): no attempt sends a dead link. Every attempt asks again whether the account is still an
 * active person (shouldSend). The token travels encrypted, in `jobs` and in `failed_jobs`.
 */
final class ResetPasswordNotification extends ResetPassword implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    /** Stands in the payload (`maxTries`); next to retryUntil() Laravel counts no tries, the pauses decide. */
    public int $tries = 5;

    /** When the token runs out: the broker wrote it just before this mail was made. */
    private readonly DateTimeInterface $expiresAt;

    public function __construct(#[\SensitiveParameter] string $token)
    {
        parent::__construct($token);

        $this->expiresAt = now()->addMinutes((int) config('auth.passwords.'.config('auth.defaults.passwords').'.expire'));
        $this->onQueue('mail')->afterCommit();
    }

    /**
     * The worker fails the job instead of running it after this moment. With retryUntil() Laravel counts no tries
     * (`$tries` has no effect next to it): the number of attempts comes from the pauses of backoff() alone, five
     * within the 60 minutes of a token (51 minutes of pauses; the next one, the last pause again, ends after it).
     */
    public function retryUntil(): DateTimeInterface
    {
        return $this->expiresAt;
    }

    /**
     * Asked on every attempt with the account read afresh: an account disabled since the link was asked for gets no
     * mail.
     *
     * @param  User  $notifiable
     */
    public function shouldSend($notifiable, string $channel): bool
    {
        return ! $notifiable->isDisabled() && $notifiable->isPerson();
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [60, 300, 900, 1800];
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
